"""Real PostgreSQL, owning CLI and independent S3 archive qualification."""

import hashlib
import importlib.util
import io
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import psycopg
import urllib3
from minio import Minio
from minio.error import S3Error
from minio.objectlockconfig import ObjectLockConfig
from minio.retention import COMPLIANCE, GOVERNANCE, Retention
from minio.sseconfig import Rule, SSEConfig
from psycopg.conninfo import conninfo_to_dict, make_conninfo
from psycopg.rows import dict_row

module = importlib.util.spec_from_file_location(
    "audit_export", Path(__file__).resolve().parents[1] / "audit_export.py"
)
archive = importlib.util.module_from_spec(module)
sys.modules[module.name] = archive
module.loader.exec_module(archive)

initializer_spec = importlib.util.spec_from_file_location(
    "nuc_archive_initialize",
    Path(__file__).resolve().parents[3] / "devices/nuc/ofz-recovery/initialize.py",
)
initialize = importlib.util.module_from_spec(initializer_spec)
initializer_spec.loader.exec_module(initialize)

IMAGE = "docker.io/chrislusf/seaweedfs@sha256:092e57674b53aaa6191b6f3041a16b23f3fcf986dd3fe600f2e0bf31cab34dfe"


def docker(*arguments: str) -> str:
    return subprocess.check_output(
        ["docker", *arguments], text=True, stderr=subprocess.DEVNULL
    ).strip()


class StoredBeforeCrash(archive.Exporter):
    def store(self, rows, now_ms):
        super().store(rows, now_ms)
        raise InterruptedError(
            "injected crash after independent storage before SQL acknowledgement"
        )


class ArchiveBoundaries(unittest.TestCase):
    def test_recovery_key_is_stable_and_corruption_is_not_replaced(self):
        with tempfile.TemporaryDirectory(prefix="ofz-recovery-key-") as temporary:
            directory = Path(temporary)
            initialize.prepare(directory)
            key = directory / "sse_kek"
            original = key.read_bytes()
            configuration = (directory / "security.toml").read_bytes()
            initialize.prepare(directory)
            self.assertEqual(original, key.read_bytes())
            self.assertEqual(configuration, (directory / "security.toml").read_bytes())
            self.assertEqual(len(bytes.fromhex(original.decode())), 32)
            key.write_text("corrupt-key")
            with self.assertRaises(archive.ArchiveError):
                initialize.prepare(directory)
            self.assertEqual(key.read_text(), "corrupt-key")
            key.write_text("00" * 32)
            with self.assertRaisesRegex(archive.ArchiveError, "identity changed"):
                initialize.prepare(directory)
            key.unlink()
            with self.assertRaisesRegex(archive.ArchiveError, "original"):
                initialize.prepare(directory)
            self.assertFalse(key.exists())

    def test_private_credentials_and_redacted_failures(self):
        with tempfile.TemporaryDirectory(
            prefix="ofz-archive-credentials-"
        ) as temporary:
            path = Path(temporary) / "credential"
            path.write_text("fixture-secret")
            path.chmod(0o600)
            self.assertEqual(
                hashlib.sha256(archive.credential(str(path)).encode()).hexdigest(),
                hashlib.sha256(b"fixture-secret").hexdigest(),
            )
            path.chmod(0o644)
            with self.assertRaises(archive.ArchiveError):
                archive.credential(str(path))
            path.chmod(0o600)
            path.write_bytes(b"x" * (16 * 1024 + 1))
            with self.assertRaises(archive.ArchiveError):
                archive.credential(str(path))
        failure = S3Error(
            None,
            "AccessDenied",
            "fixture-secret",
            "fixture-secret",
            "request",
            "host",
            object_name="fixture-secret",
        )
        report = archive.failure_report(failure, "archive_failed")
        self.assertEqual(report["code"], "AccessDenied")
        self.assertNotIn("fixture-secret", json.dumps(report))
        report = archive.failure_report(
            psycopg.OperationalError("fixture-secret"), "archive_failed"
        )
        self.assertNotIn("fixture-secret", json.dumps(report))


class RealArchive(unittest.TestCase):
    def test_independent_archive_and_bootstrap(self):
        with tempfile.TemporaryDirectory(prefix="ofz-archive-") as directory:
            root = Path(directory)
            name = f"ofz-archive-{uuid.uuid4()}"
            self.addCleanup(lambda: docker("volume", "rm", name))
            self.addCleanup(lambda: docker("rm", "--force", name))
            self.addCleanup(
                lambda: Path("/tmp/ofz-archive-seaweed-last-server.log").write_text(
                    subprocess.run(
                        ["docker", "logs", name], capture_output=True, text=True
                    ).stdout
                    + subprocess.run(
                        ["docker", "logs", name], capture_output=True, text=True
                    ).stderr
                )
            )
            credentials = root / "credentials"
            credentials.mkdir(mode=0o700)
            initialize.prepare(credentials)
            manifest_hash = hashlib.sha256(
                (credentials / "manifest.json").read_bytes()
            ).hexdigest()
            initialize.prepare(credentials)
            self.assertEqual(
                manifest_hash,
                hashlib.sha256(
                    (credentials / "manifest.json").read_bytes()
                ).hexdigest(),
            )
            filer_config = root / "filer.toml"
            filer_config.write_text(
                (
                    Path(__file__).resolve().parents[3]
                    / "devices/nuc/ofz-recovery/filer.toml"
                ).read_text()
            )
            filer_config.chmod(0o444)
            docker("volume", "create", name)
            for filename in ["s3.json", "security.toml"]:
                initialized = subprocess.run(
                    [
                        "docker",
                        "run",
                        "--rm",
                        "--interactive",
                        "--user",
                        "0:0",
                        "--cap-drop=ALL",
                        "--cap-add=CHOWN",
                        "--cap-add=DAC_OVERRIDE",
                        "--read-only",
                        "--entrypoint",
                        "/bin/sh",
                        "--mount",
                        f"type=volume,source={name},target=/data",
                        IMAGE,
                        "-ec",
                        f"cat > /data/{filename}; chmod 0600 /data/{filename}; chown 1000:1000 /data /data/{filename}",
                    ],
                    input=(credentials / filename).read_text(),
                    text=True,
                    capture_output=True,
                )
                self.assertEqual(initialized.returncode, 0, initialized.stderr)
            with socket.socket() as reservation:
                reservation.bind(("127.0.0.1", 0))
                host_port = reservation.getsockname()[1]
            docker(
                "run",
                "--detach",
                "--name",
                name,
                "--cpus=1",
                "--memory=512m",
                "--pids-limit=256",
                "--user",
                "1000:1000",
                "--cap-drop=ALL",
                "--read-only",
                "--entrypoint",
                "/usr/bin/weed",
                "--workdir",
                "/data",
                "--tmpfs",
                "/tmp:rw,nosuid,nodev,size=64m",
                "--publish",
                f"127.0.0.1:{host_port}:8333",
                "--mount",
                f"type=volume,source={name},target=/data",
                "--mount",
                f"type=bind,source={filer_config},target=/etc/seaweedfs/filer.toml,readonly",
                IMAGE,
                "server",
                "-dir=/data",
                "-ip=127.0.0.1",
                "-ip.bind=0.0.0.0",
                "-volume.max=4",
                "-master.volumeSizeLimitMB=64",
                "-master.telemetry=false",
                "-volume.minFreeSpace=1GiB",
                "-filer",
                "-filer.disableHttp",
                "-s3",
                "-s3.config=/data/s3.json",
                "-s3.iam=false",
                "-s3.port.iceberg=0",
                "-s3.port.lance=0",
            )
            endpoint = docker("port", name, "8333/tcp")
            administrator = Minio(
                endpoint,
                access_key=archive.credential(str(credentials / "root_access_key")),
                secret_key=archive.credential(str(credentials / "root_secret_key")),
                secure=False,
                region="us-east-1",
                http_client=urllib3.PoolManager(
                    timeout=urllib3.Timeout(total=8, connect=2, read=5), retries=False
                ),
            )
            storage = Minio(
                endpoint,
                access_key=archive.credential(str(credentials / "archive_access_key")),
                secret_key=archive.credential(str(credentials / "archive_secret_key")),
                secure=False,
                region="us-east-1",
                http_client=urllib3.PoolManager(
                    timeout=urllib3.Timeout(total=8, connect=2, read=5), retries=False
                ),
            )
            deadline = time.monotonic() + 45
            while True:
                try:
                    administrator.list_buckets()
                    break
                except Exception:
                    if time.monotonic() >= deadline:
                        self.fail("isolated S3 server did not become ready")
                    time.sleep(0.2)
            initialize.configure(credentials, storage=administrator)
            initialize.configure(credentials, storage=administrator)
            docker("exec", name, "/bin/sh", "-ec", "test -s /data/filer.sqlite3")
            administrator.set_object_lock_config(
                archive.BUCKET, ObjectLockConfig(COMPLIANCE, 90, "Days")
            )
            shell = [
                "docker",
                "exec",
                "--interactive",
                name,
                "/usr/bin/weed",
                "shell",
                "-master=127.0.0.1:9333",
                "-filer=127.0.0.1:8888",
            ]
            applied = subprocess.run(
                shell,
                input="fs.configure -locationPrefix=/buckets/ -fsync -volumeGrowthCount=1 -apply\n",
                capture_output=True,
                text=True,
            )
            self.assertEqual(applied.returncode, 0, applied.stderr)
            readback = subprocess.run(
                shell,
                input="fs.configure\n",
                capture_output=True,
                text=True,
                check=True,
            )
            settings = json.JSONDecoder().raw_decode(
                readback.stdout[readback.stdout.index("{") :]
            )[0]
            self.assertTrue(
                any(
                    item.get("locationPrefix") == "/buckets/"
                    and item.get("fsync") is True
                    for item in settings["locations"]
                )
            )

            config = conninfo_to_dict(os.environ["OFZ_TEST_DSN"])
            config.update(
                sslmode="verify-full",
                sslrootcert=os.environ["OFZ_TEST_CA_FILE"],
                client_encoding="UTF8",
            )
            database = psycopg.connect(**config, autocommit=True, row_factory=dict_row)
            self.addCleanup(database.close)
            database.execute(
                "CREATE ROLE ofz_migrator LOGIN PASSWORD 'archive-fixture' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT"
            )
            database.execute(
                "CREATE ROLE ofz_api LOGIN PASSWORD 'archive-fixture' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT"
            )
            database.execute(
                "CREATE ROLE ofz_archiver LOGIN PASSWORD 'archive-fixture' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT"
            )
            database.execute("GRANT CREATE ON DATABASE ofz_control TO ofz_migrator")

            password = root / "password"
            password.write_text("archive-fixture")
            password.chmod(0o600)
            manifest = root / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "operationId": str(uuid.uuid4()),
                        "activationOperationId": str(uuid.uuid4()),
                        "administratorGithubIds": ["1", "2"],
                    }
                )
            )
            manifest.chmod(0o600)
            owner = dict(config, user="ofz_migrator")
            owner.pop("password", None)
            owner.pop("sslrootcert", None)
            owner.pop("client_encoding", None)
            owner["sslmode"] = "require"
            environment = dict(
                os.environ,
                OFZ_DATABASE_DSN=make_conninfo(**owner),
                OFZ_DATABASE_PASSWORD_FILE=str(password),
                OFZ_DATABASE_CA_FILE=os.environ["OFZ_TEST_CA_FILE"],
                OFZ_SPICEDB_ENDPOINT=os.environ["OFZ_TEST_NATIVE_ENDPOINT"],
                OFZ_SPICEDB_KEY_FILE=os.environ["OFZ_TEST_NATIVE_KEY_FILE"],
            )

            def cli(operation):
                arguments = [os.environ["OFZ_BOOTSTRAP_CLI_FIXTURE"], operation]
                if operation != "migrate":
                    arguments.append(str(manifest))
                result = subprocess.run(
                    arguments,
                    env=environment,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout) if result.stdout.strip() else None

            cli("migrate")
            bootstrap = cli("bootstrap")
            self.assertTrue(bootstrap["currentPlatformFenced"])
            self.assertFalse(bootstrap["currentArchiveHealthy"])

            def connect(role):
                connection = psycopg.connect(
                    **dict(config, user=role, password="archive-fixture"),
                    autocommit=True,
                    row_factory=dict_row,
                )
                self.addCleanup(connection.close)
                return connection

            caller = connect("ofz_archiver")
            exporter = archive.Exporter(caller, storage)
            self.assertTrue(exporter.acquire())
            self.assertFalse(
                archive.Exporter(connect("ofz_archiver"), storage).acquire()
            )
            with self.assertRaises(archive.ArchiveError):
                archive.Exporter(connect("ofz_api"), storage).acquire()
            with self.assertRaises(InterruptedError):
                StoredBeforeCrash(caller, storage).tick()
            self.assertIsNone(
                database.execute(
                    "SELECT acknowledged_at_ms FROM ofz.audit_outbox"
                ).fetchone()["acknowledged_at_ms"]
            )
            self.assertEqual(exporter.tick(), 1)
            before = database.execute(
                "SELECT archive_receipt FROM ofz.audit_outbox"
            ).fetchone()["archive_receipt"]
            receipt = archive.Receipt.decode(before)
            exporter.verify_object(receipt)
            self.assertEqual(
                len(
                    list(
                        administrator.list_objects(archive.BUCKET, include_version=True)
                    )
                ),
                1,
            )
            activated = cli("activate")
            self.assertFalse(activated["currentPlatformFenced"])
            self.assertTrue(activated["currentArchiveHealthy"])
            self.assertEqual(exporter.tick(), 1)
            self.assertEqual(exporter.tick(), 0)

            plaintext = b"qualification payload with valid hash and retention"
            plaintext_hash = hashlib.sha256(plaintext).hexdigest()
            plaintext_key = f"batches/1-1-{plaintext_hash}.json"
            until = datetime.now(UTC).replace(microsecond=0) + timedelta(
                days=90, seconds=1
            )
            administrator.delete_bucket_encryption(archive.BUCKET)
            try:
                unencrypted = administrator.put_object(
                    archive.BUCKET,
                    plaintext_key,
                    io.BytesIO(plaintext),
                    len(plaintext),
                    retention=Retention(COMPLIANCE, until),
                )
            finally:
                administrator.set_bucket_encryption(
                    archive.BUCKET, SSEConfig(Rule.new_sse_s3_rule())
                )
            with self.assertRaisesRegex(archive.ArchiveError, "encrypted"):
                exporter.verify_object(
                    archive.Receipt(
                        plaintext_key,
                        unencrypted.version_id,
                        plaintext_hash,
                        until.isoformat(),
                    )
                )

            marker = f"OFZ-CIPHERTEXT-PROBE-{uuid.uuid4().hex}"
            payload = (marker.encode() * (8 * 1024 * 1024 // len(marker) + 1))[
                : 8 * 1024 * 1024
            ]
            payload_hash = hashlib.sha256(payload).hexdigest()
            encrypted = storage.put_object(
                archive.BUCKET,
                "qualification/encrypted-multipart",
                io.BytesIO(payload),
                len(payload),
            )
            self.assertTrue(encrypted.version_id)
            docker(
                "exec",
                name,
                "/bin/sh",
                "-ec",
                'if grep -aFq -- "$1" /data/*.dat /data/filer.sqlite3*; then exit 1; fi',
                "sh",
                marker,
            )

            for client in [storage, administrator]:
                with self.assertRaises(S3Error):
                    client.remove_object(
                        archive.BUCKET, receipt.key, version_id=receipt.version_id
                    )
            with self.assertRaises(S3Error):
                storage.remove_object(archive.BUCKET, receipt.key)
            with self.assertRaises(S3Error):
                storage.set_object_lock_config(
                    archive.BUCKET, ObjectLockConfig(GOVERNANCE, 1, "Days")
                )
            with self.assertRaises(S3Error):
                storage.set_object_retention(
                    archive.BUCKET,
                    receipt.key,
                    Retention(COMPLIANCE, datetime.now(UTC) + timedelta(days=1)),
                    version_id=receipt.version_id,
                )
            exporter.verify_object(receipt)

            def append(connection, label):
                row = connection.execute(
                    "INSERT INTO ofz.audit(id,receipt,target_hash) VALUES(%s,%s,%s) RETURNING sequence",
                    (
                        uuid.uuid4(),
                        json.dumps({"fixture": label}),
                        hashlib.sha256(label.encode()).digest(),
                    ),
                ).fetchone()
                connection.execute(
                    "INSERT INTO ofz.audit_outbox(audit_sequence) VALUES(%s)",
                    (row["sequence"],),
                )
                return row["sequence"]

            delayed = connect("ofz_api")
            with delayed.transaction():
                older = append(delayed, "delayed-commit")
                newer = append(connect("ofz_api"), "later-sequence-first-commit")
                self.assertGreater(newer, older)
                self.assertEqual(exporter.tick(), 1)
            self.assertEqual(exporter.tick(), 1)
            self.assertEqual(exporter.tick(), 0)
            self.assertEqual(
                database.execute(
                    "SELECT acknowledged_sequence FROM ofz.archive_state"
                ).fetchone()["acknowledged_sequence"],
                newer,
            )
            self.assertEqual(
                database.execute(
                    "SELECT count(*) AS pending FROM ofz.audit_outbox WHERE acknowledged_at_ms IS NULL"
                ).fetchone()["pending"],
                0,
            )

            docker("kill", "--signal=KILL", name)
            with self.assertRaises(Exception):
                exporter.tick()
            self.assertEqual(
                database.execute(
                    "SELECT acknowledged_at_ms FROM ofz.archive_state"
                ).fetchone()["acknowledged_at_ms"],
                0,
            )
            self.assertFalse(cli("activate")["currentArchiveHealthy"])
            docker("start", name)
            self.assertEqual(docker("port", name, "8333/tcp"), endpoint)
            deadline = time.monotonic() + 30
            while True:
                try:
                    exporter.tick()
                    break
                except Exception:
                    if time.monotonic() >= deadline:
                        self.fail(
                            "independent archive did not recover its immutable versions"
                        )
                    time.sleep(0.2)
            self.assertTrue(cli("activate")["currentArchiveHealthy"])
            exporter.verify_object(receipt)
            response = storage.get_object(
                archive.BUCKET,
                "qualification/encrypted-multipart",
                version_id=encrypted.version_id,
            )
            try:
                self.assertEqual(
                    response.headers.get("x-amz-server-side-encryption"), "AES256"
                )
                self.assertEqual(
                    hashlib.sha256(response.read()).hexdigest(), payload_hash
                )
            finally:
                response.close()
                response.release_conn()
            self.assertTrue(
                initialize.verify(credentials, writer=storage, root=administrator)[
                    "rootVersionDeleteDenied"
                ]
            )
            self.assertEqual(
                before,
                database.execute(
                    "SELECT archive_receipt FROM ofz.audit_outbox ORDER BY audit_sequence LIMIT 1"
                ).fetchone()["archive_receipt"],
            )
            administrator.set_object_lock_config(
                archive.BUCKET, ObjectLockConfig(GOVERNANCE, 1, "Days")
            )
            with self.assertRaises(archive.ArchiveError):
                exporter.tick()
            self.assertEqual(
                database.execute(
                    "SELECT acknowledged_at_ms FROM ofz.archive_state"
                ).fetchone()["acknowledged_at_ms"],
                0,
            )
            administrator.set_object_lock_config(
                archive.BUCKET, ObjectLockConfig(COMPLIANCE, 90, "Days")
            )
            exporter.tick()
            sequence = append(connect("ofz_api"), "independent-readback-corruption")
            with self.assertRaises(InterruptedError):
                StoredBeforeCrash(caller, storage).tick()
            original = next(
                administrator.list_objects(
                    archive.BUCKET,
                    prefix=f"batches/{sequence}-{sequence}-",
                    include_version=True,
                )
            )
            original_response = administrator.get_object(
                archive.BUCKET, original.object_name, version_id=original.version_id
            )
            try:
                original_data = original_response.read(archive.MAX_BATCH_BYTES + 1)
            finally:
                original_response.close()
                original_response.release_conn()
            protected_until = datetime.now(UTC) + timedelta(days=90, minutes=1)
            administrator.put_object(
                archive.BUCKET,
                original.object_name,
                io.BytesIO(b"changed payload"),
                len(b"changed payload"),
                retention=Retention(COMPLIANCE, protected_until),
            )
            with self.assertRaisesRegex(archive.ArchiveError, "readback mismatch"):
                exporter.tick()
            self.assertIsNone(
                database.execute(
                    "SELECT acknowledged_at_ms FROM ofz.audit_outbox WHERE audit_sequence=%s",
                    (sequence,),
                ).fetchone()["acknowledged_at_ms"]
            )
            administrator.put_object(
                archive.BUCKET,
                original.object_name,
                io.BytesIO(original_data),
                len(original_data),
                retention=Retention(COMPLIANCE, datetime.now(UTC) + timedelta(days=1)),
            )
            with self.assertRaisesRegex(
                archive.ArchiveError, "retention does not cover"
            ):
                exporter.tick()
            self.assertIsNone(
                database.execute(
                    "SELECT acknowledged_at_ms FROM ofz.audit_outbox WHERE audit_sequence=%s",
                    (sequence,),
                ).fetchone()["acknowledged_at_ms"]
            )
            administrator.put_object(
                archive.BUCKET,
                original.object_name,
                io.BytesIO(original_data),
                len(original_data),
                retention=Retention(COMPLIANCE, protected_until),
            )
            self.assertEqual(exporter.tick(), 1)
            sequence = append(connect("ofz_api"), "receipt-after-clock-snapshot")
            newer_receipt = database.execute(
                "SELECT sequence,receipt,encode(target_hash,'hex') AS target_hash,created_at_ms FROM ofz.audit WHERE sequence=%s",
                (sequence,),
            ).fetchone()
            deadline_receipt = exporter.store(
                [newer_receipt], newer_receipt["created_at_ms"] - 2000
            )
            required_until = datetime.fromtimestamp(
                newer_receipt["created_at_ms"] / 1000, UTC
            ) + timedelta(days=90)
            self.assertGreaterEqual(
                datetime.fromisoformat(deadline_receipt.retained_until), required_until
            )
            self.assertEqual(exporter.tick(), 1)
            original_budget = archive.MAX_BATCH_BYTES
            try:
                archive.MAX_BATCH_BYTES = 3000
                for index in range(6):
                    append(connect("ofz_api"), f"bounded-batch-{index}-" + "x" * 900)
                counts = []
                while database.execute(
                    "SELECT count(*) AS pending FROM ofz.audit_outbox WHERE acknowledged_at_ms IS NULL"
                ).fetchone()["pending"]:
                    counts.append(exporter.tick())
                self.assertEqual(sum(counts), 6)
                self.assertGreater(len(counts), 1)
                self.assertTrue(all(count > 0 for count in counts))
            finally:
                archive.MAX_BATCH_BYTES = original_budget
            print(
                "PASS: independent versioned compliance archive; encrypted multipart and ciphertext backing-store proof; unencrypted versions rejected; stable recovery key; real bootstrap/activation; owner and writer role boundaries; version-specific deletion and retention shortening denied; interrupted upload retries; out-of-order audit commits; crash/restart readback; archive failure fences without fabricated acknowledgement"
            )


if __name__ == "__main__":
    unittest.main()

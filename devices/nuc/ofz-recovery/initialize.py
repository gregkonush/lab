#!/usr/bin/env python3
"""Prepare and verify the independent NUC archive without printing credentials."""

import argparse
import hashlib
import io
import json
import os
import secrets
import ssl
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import urllib3
from minio import Minio
from minio.error import S3Error
from minio.objectlockconfig import ObjectLockConfig
from minio.retention import COMPLIANCE, Retention

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "services/ofz"))
from audit_export import (
    BUCKET,
    ENDPOINT,
    RETENTION_DAYS,
    ArchiveError,
    credential,
    failure_report,
)  # noqa: E402


def write_private(path: Path, value: str, *, exclusive: bool = False) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW
    flags |= os.O_EXCL if exclusive else os.O_TRUNC
    with os.fdopen(os.open(path, flags, 0o600), "w") as target:
        os.fchmod(target.fileno(), 0o600)
        target.write(value)
        target.flush()
        os.fsync(target.fileno())


def prepare(directory: Path) -> None:
    if (
        directory.is_symlink()
        or not directory.is_dir()
        or directory.stat().st_mode & 0o077
    ):
        raise ArchiveError("dedicated private credential directory required")
    manifest = directory / "manifest.json"
    if not manifest.exists():
        values = {
            "version": 1,
            "root_access_key": f"OFZROOT{secrets.token_hex(10).upper()}",
            "root_secret_key": secrets.token_hex(32),
            "archive_access_key": f"OFZAUDIT{secrets.token_hex(10).upper()}",
            "archive_secret_key": secrets.token_hex(32),
        }
        temporary = directory / f".manifest-{secrets.token_hex(8)}"
        write_private(temporary, json.dumps(values, sort_keys=True), exclusive=True)
        try:
            os.link(temporary, manifest)
        except FileExistsError:
            pass
        finally:
            temporary.unlink()
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    values = json.loads(credential(str(manifest)))
    names = {
        "root_access_key",
        "root_secret_key",
        "archive_access_key",
        "archive_secret_key",
    }
    if values.get("version") != 1 or set(values) != names | {"version"}:
        raise ArchiveError("unsupported recovery credential manifest")
    for name in names:
        if (
            not isinstance(values[name], str)
            or not values[name].isalnum()
            or len(values[name]) < 20
        ):
            raise ArchiveError("invalid recovery credential manifest")
        write_private(directory / name, values[name])
    policy = json.loads(Path(__file__).with_name("audit-policy.json").read_text())
    identities = [
        {
            "name": "ofz-recovery-custodian",
            "credentials": [
                {
                    "access_key": values["root_access_key"],
                    "secret_key": values["root_secret_key"],
                }
            ],
            "actions": ["Admin"],
        },
        {
            "name": "ofz-audit-export",
            "credentials": [
                {
                    "access_key": values["archive_access_key"],
                    "secret_key": values["archive_secret_key"],
                }
            ],
            "policy_names": ["audit-export"],
        },
    ]
    write_private(
        directory / "s3.json",
        json.dumps(
            {
                "identities": identities,
                "policies": [{"name": "audit-export", "content": json.dumps(policy)}],
            },
            sort_keys=True,
        ),
    )


def client(directory: Path, *, root: bool, local: bool = False) -> Minio:
    prefix = "root" if root else "archive"
    return Minio(
        "127.0.0.1:9445" if local else ENDPOINT,
        access_key=credential(str(directory / f"{prefix}_access_key")),
        secret_key=credential(str(directory / f"{prefix}_secret_key")),
        secure=not local,
        region="us-east-1",
        http_client=urllib3.PoolManager(
            ssl_context=ssl.create_default_context(
                cafile=os.environ.get("SSL_CERT_FILE")
            ),
            timeout=urllib3.Timeout(total=8, connect=2, read=5),
            retries=False,
        ),
    )


def configure(directory: Path, storage: Minio | None = None) -> None:
    storage = storage or client(directory, root=True, local=True)
    if not storage.bucket_exists(BUCKET):
        storage.make_bucket(BUCKET, object_lock=True)
    try:
        existing = storage.get_object_lock_config(BUCKET)
    except S3Error as error:
        if error.code != "ObjectLockConfigurationNotFoundError":
            raise
        existing = ObjectLockConfig(None, None, None)
    if existing.mode is None:
        storage.set_object_lock_config(
            BUCKET, ObjectLockConfig(COMPLIANCE, RETENTION_DAYS, "Days")
        )
    elif (
        existing.mode != COMPLIANCE
        or existing.duration_unit != "Days"
        or existing.duration < RETENTION_DAYS
    ):
        raise ArchiveError("existing archive has an unapproved retention policy")


def denied(operation) -> None:
    try:
        operation()
    except S3Error as error:
        if error.code in {"AccessDenied", "InvalidRequest"}:
            return
        raise
    raise ArchiveError("archive accepted a forbidden mutation")


def verify(
    directory: Path, writer: Minio | None = None, root: Minio | None = None
) -> dict:
    writer = writer or client(directory, root=False)
    root = root or client(directory, root=True)
    config = writer.get_object_lock_config(BUCKET)
    if (
        writer.get_bucket_versioning(BUCKET).status != "Enabled"
        or config.mode != COMPLIANCE
        or config.duration_unit != "Days"
        or config.duration < RETENTION_DAYS
    ):
        raise ArchiveError("versioned ninety-day compliance archive required")
    data = b"Ofz independent archive qualification version 1\n"
    digest = hashlib.sha256(data).hexdigest()
    key = f"qualification/{digest}.txt"
    until = datetime.now(UTC).replace(microsecond=0) + timedelta(
        days=RETENTION_DAYS, seconds=1
    )
    written = writer.put_object(
        BUCKET, key, io.BytesIO(data), len(data), retention=Retention(COMPLIANCE, until)
    )
    if not written.version_id:
        raise ArchiveError("archive did not return an immutable version")
    retention = writer.get_object_retention(BUCKET, key, version_id=written.version_id)
    if retention.mode != COMPLIANCE or retention.retain_until_date < until:
        raise ArchiveError("archive retention readback failed")
    response = writer.get_object(BUCKET, key, version_id=written.version_id)
    try:
        if response.read(len(data) + 1) != data:
            raise ArchiveError("archive version readback failed")
    finally:
        response.close()
        response.release_conn()
    denied(lambda: writer.remove_object(BUCKET, key))
    denied(lambda: writer.remove_object(BUCKET, key, version_id=written.version_id))
    denied(lambda: root.remove_object(BUCKET, key, version_id=written.version_id))
    denied(
        lambda: writer.set_object_lock_config(
            BUCKET, ObjectLockConfig(COMPLIANCE, 1, "Days")
        )
    )
    denied(
        lambda: root.set_object_retention(
            BUCKET,
            key,
            Retention(COMPLIANCE, datetime.now(UTC) + timedelta(days=1)),
            version_id=written.version_id,
        )
    )
    return {
        "expectedEndpoint": f"https://{ENDPOINT}",
        "bucket": BUCKET,
        "mode": COMPLIANCE,
        "retainedUntil": retention.retain_until_date.isoformat(),
        "versionId": written.version_id,
        "sha256": digest,
        "writerDeleteDenied": True,
        "rootVersionDeleteDenied": True,
        "retentionShorteningDenied": True,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "operation", choices=["prepare", "configure", "verify", "verify-local"]
    )
    parser.add_argument("directory", type=Path)
    arguments = parser.parse_args()
    if arguments.operation == "prepare":
        prepare(arguments.directory)
    elif arguments.operation == "configure":
        configure(arguments.directory)
    elif arguments.operation == "verify-local":
        report = verify(
            arguments.directory,
            writer=client(arguments.directory, root=False, local=True),
            root=client(arguments.directory, root=True, local=True),
        )
        print(json.dumps({"boundary": "NUC loopback S3", **report}, sort_keys=True))
    else:
        print(json.dumps(verify(arguments.directory), sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as failure:
        print(
            json.dumps(failure_report(failure, "recovery_initialization_failed")),
            file=sys.stderr,
        )
        sys.exit(1)

import io
import json
from pathlib import Path
import sqlite3
import tarfile
import tempfile
import unittest

from migrate_state import export_state, inventory, restore_state


class StateMigrationTest(unittest.TestCase):
    def test_preserves_sessions_claims_and_sqlite_without_overwrite(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "source"
            target = Path(temporary) / "target"
            source.mkdir()
            target.mkdir()
            (source / "studies").mkdir()
            (source / "studies" / "exclusive.claim.json").write_text('{"claimed":true}')
            with sqlite3.connect(source / "sessions.sqlite") as db:
                db.execute("CREATE TABLE sessions (id TEXT PRIMARY KEY)")
                db.execute("INSERT INTO sessions VALUES ('ses_retained')")
            archive = io.BytesIO()
            before = inventory(source)
            export_state(source, archive)
            archive.seek(0)
            restore_state(target, archive)
            marker = json.loads(
                (target / "state" / ".migration-complete.json").read_text()
            )
            restored = inventory(target / "state")
            del restored[".migration-complete.json"]
            self.assertEqual(before, restored)
            self.assertEqual(marker["files"], len(before))
            self.assertEqual(inventory(source), before)
            archive.seek(0)
            with self.assertRaisesRegex(ValueError, "overwrite"):
                restore_state(target, archive)

    def test_rejects_corruption_before_installing_state(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary)
            archive = io.BytesIO()
            with tarfile.open(fileobj=archive, mode="w") as output:
                for name, data in [
                    ("manifest.json", b'{"claim.json":{"sha256":"wrong","size":7}}'),
                    ("state/claim.json", b"changed"),
                ]:
                    entry = tarfile.TarInfo(name)
                    entry.size = len(data)
                    output.addfile(entry, io.BytesIO(data))
            archive.seek(0)
            with self.assertRaisesRegex(ValueError, "differs"):
                restore_state(target, archive)
            self.assertFalse((target / "state").exists())

    def test_rejects_path_traversal(self):
        with tempfile.TemporaryDirectory() as temporary:
            archive = io.BytesIO()
            with tarfile.open(fileobj=archive, mode="w") as output:
                entry = tarfile.TarInfo("../escape")
                entry.size = 1
                output.addfile(entry, io.BytesIO(b"x"))
            archive.seek(0)
            with self.assertRaises(tarfile.FilterError):
                restore_state(Path(temporary), archive)
            self.assertFalse((Path(temporary) / "state").exists())


if __name__ == "__main__":
    unittest.main()

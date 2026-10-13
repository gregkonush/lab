import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "collect", Path(__file__).with_name("collect.py")
)
collect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collect)


class FakeCollection(collect.Collection):
    def __init__(self):
        super().__init__("fixture")
        self.actions = []
        self.copies = {}
        self.fail_delete = False
        self.resources = {
            ("argocd", "application", "registry"): {
                "metadata": {"uid": "app", "resourceVersion": "1", "annotations": {}},
                "spec": {"source": {"path": "argocd/applications/registry"}},
            },
            ("registry", "deployment", "registry"): {
                "metadata": {"uid": "deployment", "generation": 1},
                "spec": {
                    "template": {
                        "spec": {"containers": [{"name": "registry", "env": []}]}
                    }
                },
            },
            ("registry", "pvc", "registry-data"): {
                "metadata": {"uid": "claim"},
                "spec": {"volumeName": "volume"},
                "status": {"phase": "Bound"},
            },
        }

    def get(self, namespace, kind, name):
        return copy.deepcopy(self.resources[namespace, kind, name])

    def command(self, args, timeout=60):
        if "delete" in args:
            self.actions.append("delete-helper")
            if self.fail_delete:
                raise RuntimeError("helper deletion unconfirmed")
        if "get" in args and "pods" in args:
            return json.dumps(
                {
                    "items": [
                        {
                            "spec": {"nodeName": "node"},
                            "status": {"containerStatuses": [{"ready": True}]},
                        }
                    ]
                }
            )
        if "cp" in args:
            self.copies[args[4].split("/dev/shm/")[1]] = Path(args[3]).read_bytes()
        if "exec" in args:
            code = args[-1]
            name = code.split("/dev/shm/")[1].split("'")[0]
            return hashlib.sha256(self.copies[name]).hexdigest()
        return ""

    def rollout(self, deadline):
        self.actions.append("rollout")

    def patch(self, namespace, kind, name, value, strategy="json"):
        resource = self.resources[namespace, kind, name]
        if kind == "application":
            annotations = resource["metadata"]["annotations"]
            if value[-1]["op"] == "add":
                annotations[collect.HOLD] = "true"
                annotations[collect.OWNER] = self.owner
                self.actions.append("hold")
            else:
                annotations.pop(collect.HOLD)
                annotations.pop(collect.OWNER)
                self.actions.append("release-hold")
        else:
            changes = value["spec"]["template"]["spec"]
            spec = resource["spec"]["template"]["spec"]
            if changes["nodeName"] is None:
                spec.pop("nodeName", None)
                spec["containers"][0]["env"] = []
                self.actions.append("restore-writes")
            else:
                spec["nodeName"] = changes["nodeName"]
                spec["containers"][0]["env"] = [
                    {"name": collect.READONLY, "value": '{"enabled":true}'}
                ]
                self.actions.append("freeze")


class CollectionTest(unittest.TestCase):
    def test_remote_timeout_deletes_collector_before_restoring_writes_and_hold(self):
        with tempfile.TemporaryDirectory() as directory:
            plan = Path(directory) / "plan.json"
            plan.write_text('{"pvcUid":"claim","pv":"volume"}')
            refs = Path(directory) / "refs.json"
            refs.write_text('["fixture"]')
            operation = FakeCollection()
            with patch.object(
                collect.subprocess,
                "run",
                side_effect=subprocess.TimeoutExpired("remote collector", 240),
            ):
                with self.assertRaises(subprocess.TimeoutExpired):
                    operation.run(plan, refs)
            actions = operation.actions
            self.assertLess(
                actions.index("delete-helper"), actions.index("restore-writes")
            )
            self.assertLess(
                actions.index("restore-writes"), actions.index("release-hold")
            )
            self.assertNotIn(
                collect.OWNER,
                operation.get("argocd", "application", "registry")["metadata"][
                    "annotations"
                ],
            )

    def test_unconfirmed_helper_deletion_keeps_writes_disabled_and_hold(self):
        operation = FakeCollection()
        operation.fail_delete = True
        operation.patch(
            "registry",
            "deployment",
            "registry",
            {"spec": {"template": {"spec": {"nodeName": "node", "containers": []}}}},
        )
        operation.patch("argocd", "application", "registry", [{"op": "add"}])
        with self.assertRaisesRegex(RuntimeError, "unconfirmed"):
            operation.restore(
                "app", "deployment", "claim", "volume", "node", True, True
            )
        self.assertNotIn("restore-writes", operation.actions)
        self.assertNotIn("release-hold", operation.actions)


if __name__ == "__main__":
    unittest.main()

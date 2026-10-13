import json
import subprocess
import unittest
from unittest.mock import patch

import protected_references as protection


class ProtectedReferencesTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.fail_resource = None
        self.registry = "registry.ide-newton.ts.net/lab/"
        self.idle = self.registry + "anypi:0123456789@sha256:" + "a" * 64
        self.objects = {
            "agentproviders.agents.proompteng.ai": [
                {"kind": "AgentProvider", "spec": {"workload": {"image": self.idle}}}
            ],
            "workflowtemplates.argoproj.io": [
                {
                    "spec": {
                        "templates": [
                            {"container": {"image": self.registry + "worker:retained"}}
                        ]
                    }
                }
            ],
            "services.serving.knative.dev": [
                {
                    "spec": {
                        "template": {
                            "spec": {
                                "containers": [
                                    {"image": self.registry + "scaled-to-zero:retained"}
                                ]
                            }
                        }
                    }
                }
            ],
            "clusterimagecatalogs.postgresql.cnpg.io": [
                {"spec": {"images": [{"image": self.registry + "postgres:retained"}]}}
            ],
            "freights.kargo.akuity.io": [
                {
                    "metadata": {"namespace": "other-delivery"},
                    "images": [
                        {
                            "repoURL": self.registry + "release",
                            "tag": "retained",
                            "digest": "sha256:" + "b" * 64,
                        }
                    ],
                }
            ],
        }

    def read(self, args, **kwargs):
        self.calls.append(args)
        self.assertEqual(args[:3], ["kubectl", "--context", "fixture"])
        resources = args[args.index("get") + 1]
        if resources == "freight,stages,promotions":
            return b'{"items":[]}'
        if resources == "customresourcedefinitions":
            rows = [
                {"metadata": {"name": name}, "spec": {"versions": [{"served": True}]}}
                for name in self.objects
            ]
            rows.append(
                {
                    "metadata": {"name": "unserved.example.com"},
                    "spec": {"versions": [{"served": False}]},
                }
            )
            return json.dumps({"items": rows}).encode()
        self.assertIn("--all-namespaces", args)
        if resources.startswith("pods,"):
            return b'{"items":[{"spec":{"containers":[{"image":"registry.ide-newton.ts.net/lab/running:latest"}]}}]}'
        if self.fail_resource and self.fail_resource in resources.split(","):
            raise subprocess.CalledProcessError(1, args)
        self.assertNotIn("unserved.example.com", resources)
        return json.dumps(
            {
                "items": [
                    row for name in resources.split(",") for row in self.objects[name]
                ]
            }
        ).encode()

    def test_idle_provider_is_protected_without_a_pod_or_job(self):
        with patch.object(protection.subprocess, "check_output", side_effect=self.read):
            result = protection.references("fixture")
        self.assertIn(self.idle, result)
        self.assertIn(self.registry + "running:latest", result)

    def test_templates_scale_to_zero_catalogs_and_kargo_in_other_namespaces_are_protected(
        self,
    ):
        with patch.object(protection.subprocess, "check_output", side_effect=self.read):
            result = protection.references("fixture")
        for image in (
            "worker:retained",
            "scaled-to-zero:retained",
            "postgres:retained",
            "release:retained",
            "release@sha256:" + "b" * 64,
        ):
            self.assertIn(self.registry + image, result)
        self.assertEqual(result, sorted(set(result)))

    def test_failed_custom_resource_list_aborts_the_entire_snapshot(self):
        self.fail_resource = "agentproviders.agents.proompteng.ai"
        with patch.object(protection.subprocess, "check_output", side_effect=self.read):
            with self.assertRaises(subprocess.CalledProcessError):
                protection.references("fixture")

    def test_failed_crd_discovery_aborts_the_entire_snapshot(self):
        def denied(args, **kwargs):
            if "customresourcedefinitions" in args:
                raise subprocess.CalledProcessError(1, args)
            return self.read(args, **kwargs)

        with patch.object(protection.subprocess, "check_output", side_effect=denied):
            with self.assertRaises(subprocess.CalledProcessError):
                protection.references("fixture")


if __name__ == "__main__":
    unittest.main()

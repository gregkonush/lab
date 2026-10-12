#!/usr/bin/env python3
"""Delete quarantined data online through a Job that cannot mount live registry blobs."""

import argparse
import json
from pathlib import Path
import re
import time
import uuid

from collect import Collection, PYTHON_IMAGE


def run(context, batch, output):
    if not re.fullmatch(r"[a-z0-9-]{1,80}", batch):
        raise ValueError("Invalid quarantine identifier")
    client = Collection(context)
    name = "registry-purge-" + uuid.uuid4().hex[:12]
    deployment = client.get("registry", "deployment", "registry")
    spec = deployment["spec"]["template"]["spec"]
    if any(
        e["name"].startswith("REGISTRY_STORAGE_MAINTENANCE_READONLY")
        for c in spec["containers"]
        for e in c.get("env", [])
    ):
        raise RuntimeError("Restore uploads before starting physical deletion")
    pods = json.loads(
        client.command(
            ["-n", "registry", "get", "pods", "-l", "app=registry", "-o", "json"]
        )
    )["items"]
    if len(pods) != 1:
        raise RuntimeError("Require exactly one registry Pod")
    job = {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {"name": name, "namespace": "registry"},
        "spec": {
            "backoffLimit": 0,
            "activeDeadlineSeconds": 3600,
            "ttlSecondsAfterFinished": 3600,
            "template": {
                "spec": {
                    "nodeName": pods[0]["spec"]["nodeName"],
                    "restartPolicy": "Never",
                    "automountServiceAccountToken": False,
                    "securityContext": {"seccompProfile": {"type": "RuntimeDefault"}},
                    "containers": [
                        {
                            "name": "purge",
                            "image": PYTHON_IMAGE,
                            "command": [
                                "python3",
                                "/work/cleanup.py",
                                "purge",
                                "--root",
                                "/quarantine",
                                "--quarantine-id",
                                batch,
                                "--workers",
                                "8",
                            ],
                            "resources": {
                                "requests": {"cpu": "50m", "memory": "64Mi"},
                                "limits": {"cpu": "1", "memory": "512Mi"},
                            },
                            "securityContext": {
                                "allowPrivilegeEscalation": False,
                                "readOnlyRootFilesystem": True,
                                "capabilities": {"drop": ["ALL"]},
                            },
                            "volumeMounts": [
                                {
                                    "name": "data",
                                    "mountPath": "/quarantine",
                                    "subPath": "docker/registry/v2/_gc_quarantine",
                                },
                                {
                                    "name": "script",
                                    "mountPath": "/work",
                                    "readOnly": True,
                                },
                            ],
                        }
                    ],
                    "volumes": [
                        {
                            "name": "data",
                            "persistentVolumeClaim": {"claimName": "registry-data"},
                        },
                        {"name": "script", "configMap": {"name": name}},
                    ],
                }
            },
        },
    }
    manifest = output.with_suffix(".job.json")
    manifest.write_text(json.dumps(job, indent=2))
    client.command(
        [
            "-n",
            "registry",
            "create",
            "configmap",
            name,
            "--from-file=cleanup.py=" + str(Path(__file__).with_name("cleanup.py")),
        ]
    )
    client.command(["-n", "registry", "create", "-f", str(manifest)])
    print(
        json.dumps({"job": name, "quarantineId": batch, "registryWrites": "enabled"}),
        flush=True,
    )
    while True:
        value = client.get("registry", "job", name)
        if value.get("status", {}).get("succeeded"):
            break
        if value.get("status", {}).get("failed") or any(
            c["type"] == "Failed" and c["status"] == "True"
            for c in value.get("status", {}).get("conditions", [])
        ):
            raise RuntimeError(
                "Quarantine purge failed; preserve its receipt and inspect Job " + name
            )
        time.sleep(10)
    logs = client.command(["-n", "registry", "logs", "job/" + name], timeout=60)
    output.write_text(logs)
    receipt = json.loads(logs.splitlines()[-1])
    print(json.dumps(receipt), flush=True)
    client.command(
        ["-n", "registry", "delete", "job", name, "--wait=true", "--timeout=60s"],
        timeout=70,
    )
    client.command(["-n", "registry", "delete", "configmap", name])
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True)
    parser.add_argument("--quarantine-id", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    run(args.context, args.quarantine_id, args.output)

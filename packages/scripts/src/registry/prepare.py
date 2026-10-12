#!/usr/bin/env python3
"""Prepare a retention plan on a read-only mount while registry uploads remain open."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess

from collect import Collection, PYTHON_IMAGE
from protected_references import references


def run(context, plan_path, reference_path):
    client = Collection(context)
    client.name = client.name.replace("registry-collect-", "registry-prepare-")
    pvc = client.get("registry", "pvc", "registry-data")
    pods = json.loads(
        client.command(
            ["-n", "registry", "get", "pods", "-l", "app=registry", "-o", "json"]
        )
    )["items"]
    if len(pods) != 1 or pvc["status"]["phase"] != "Bound":
        raise RuntimeError("Require one registry Pod and a Bound claim")
    reference_path.write_text(json.dumps(references(context)))
    pod = {
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": {"name": client.name, "namespace": "registry"},
        "spec": {
            "nodeName": pods[0]["spec"]["nodeName"],
            "restartPolicy": "Never",
            "terminationGracePeriodSeconds": 1,
            "automountServiceAccountToken": False,
            "activeDeadlineSeconds": 1800,
            "securityContext": {"seccompProfile": {"type": "RuntimeDefault"}},
            "containers": [
                {
                    "name": "prepare",
                    "image": PYTHON_IMAGE,
                    "command": ["sleep", "1800"],
                    "resources": {
                        "requests": {"cpu": "50m", "memory": "64Mi"},
                        "limits": {"cpu": "2", "memory": "2Gi"},
                    },
                    "securityContext": {
                        "allowPrivilegeEscalation": False,
                        "readOnlyRootFilesystem": True,
                        "capabilities": {"drop": ["ALL"]},
                    },
                    "volumeMounts": [
                        {
                            "name": "data",
                            "mountPath": "/var/lib/registry",
                            "readOnly": True,
                        }
                    ],
                }
            ],
            "volumes": [
                {
                    "name": "data",
                    "persistentVolumeClaim": {"claimName": "registry-data"},
                }
            ],
        },
    }
    manifest = plan_path.with_suffix(".prepare-pod.json")
    manifest.write_text(json.dumps(pod, indent=2))
    try:
        client.command(["-n", "registry", "create", "-f", str(manifest)])
        client.command(
            [
                "-n",
                "registry",
                "wait",
                "--for=condition=Ready",
                "pod/" + client.name,
                "--timeout=60s",
            ],
            timeout=70,
        )
        for source, destination in [
            (Path(__file__).with_name("cleanup.py"), "cleanup.py"),
            (reference_path, "references.json"),
        ]:
            client.command(
                [
                    "-n",
                    "registry",
                    "cp",
                    str(source),
                    client.name + ":/dev/shm/" + destination,
                    "-c",
                    "prepare",
                ]
            )
            actual = client.command(
                [
                    "-n",
                    "registry",
                    "exec",
                    client.name,
                    "-c",
                    "prepare",
                    "--",
                    "python3",
                    "-c",
                    "import pathlib,hashlib;print(hashlib.sha256(pathlib.Path('/dev/shm/"
                    + destination
                    + "').read_bytes()).hexdigest())",
                ]
            ).strip()
            if actual != hashlib.sha256(source.read_bytes()).hexdigest():
                raise RuntimeError("Incomplete helper input transfer")
        with (
            plan_path.open("w") as output,
            plan_path.with_suffix(".prepare.log").open("w") as errors,
        ):
            process = subprocess.run(
                client.kubectl
                + [
                    "-n",
                    "registry",
                    "exec",
                    client.name,
                    "-c",
                    "prepare",
                    "--",
                    "python3",
                    "/dev/shm/cleanup.py",
                    "prepare",
                    "--references",
                    "/dev/shm/references.json",
                    "--workers",
                    "32",
                ],
                stdout=output,
                stderr=errors,
                timeout=1700,
            )
        if process.returncode:
            raise RuntimeError(
                "Preparation failed; inspect "
                + str(plan_path.with_suffix(".prepare.log"))
            )
        plan = json.loads(plan_path.read_text())
        plan["pvcUid"] = pvc["metadata"]["uid"]
        plan["pv"] = pvc["spec"]["volumeName"]
        plan_path.write_text(json.dumps(plan))
        return {
            "plan": str(plan_path),
            "references": str(reference_path),
            "candidates": len(plan["blobs"]),
            "candidateBytes": plan["candidateBytes"],
            "registryWrites": "unchanged",
        }
    finally:
        client.command(
            [
                "-n",
                "registry",
                "delete",
                "pod",
                client.name,
                "--ignore-not-found",
                "--wait=true",
                "--timeout=60s",
            ],
            timeout=70,
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--references", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(run(args.context, args.plan, args.references)))

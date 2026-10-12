#!/usr/bin/env python3
"""Protect built-in and custom workload images without saving cluster objects."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess

HOSTS = ("registry.ide-newton.ts.net/", "registry.registry.svc.cluster.local/")


def references(context):
    workloads = [
        "-n",
        "registry",
        "get",
        "pods,deployments,statefulsets,daemonsets,cronjobs,jobs",
        "--all-namespaces",
        "-o",
        "json",
    ]
    result = set()

    def visit(value):
        if isinstance(value, str):
            if (
                value.startswith(HOSTS)
                and not any(c.isspace() for c in value)
                and ("@" in value or ":" in value.split("/", 1)[1])
            ):
                result.add(value)
        elif isinstance(value, dict):
            repository = value.get("repoURL", "")
            if isinstance(repository, str) and repository.startswith(HOSTS):
                if value.get("digest"):
                    result.add(repository + "@" + value["digest"])
                if value.get("tag"):
                    result.add(repository + ":" + value["tag"])
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    def read(args):
        return json.loads(
            subprocess.check_output(
                ["kubectl", "--context", context, *args], timeout=60
            )
        )

    with ThreadPoolExecutor(max_workers=4) as pool:
        builtins = pool.submit(read, workloads)
        definitions = pool.submit(
            read, ["-n", "registry", "get", "customresourcedefinitions", "-o", "json"]
        )
        visit(builtins.result())
        resources = sorted(
            {
                item["metadata"]["name"]
                for item in definitions.result()["items"]
                if any(version["served"] for version in item["spec"]["versions"])
            }
        )
        # CRDs include idle providers, scale-to-zero services, workflow templates and Kargo
        # artifacts in every namespace. An incomplete read must abort preparation.
        commands = [
            [
                "-n",
                "registry",
                "get",
                ",".join(resources[start : start + 8]),
                "--all-namespaces",
                "-o",
                "json",
            ]
            for start in range(0, len(resources), 8)
        ]
        for value in pool.map(read, commands):
            visit(value)
    if not result:
        raise RuntimeError("No protected references found; refuse cleanup")
    return sorted(result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--context", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    values = references(args.context)
    args.output.write_text(json.dumps(values, indent=2) + "\n")
    print(json.dumps({"protectedReferences": len(values)}))


if __name__ == "__main__":
    main()

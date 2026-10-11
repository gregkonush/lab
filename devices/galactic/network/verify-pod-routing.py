#!/usr/bin/env python3
"""Check the fixed PodCIDRs and live forwarding paths without changing the cluster."""

import argparse
import ipaddress
import json
import subprocess
import sys


NODES = {
    "talos-192-168-1-85": ("10.244.4.0/23", "100.100.244.142", "enP5p1s0"),
    "turin": ("10.244.0.0/23", "100.100.244.190", "eno2np1"),
    "talos-192-168-1-194": ("10.244.3.0/24", "100.100.244.141", "eno1"),
}
STORAGE = {"talos-192-168-1-85": "10.100.0.11", "turin": "10.100.0.12"}
KUBECTL = ["kubectl", "--context", "galactic-lan", "-n", "kube-system"]


def query(args):
    result = subprocess.run(
        KUBECTL + args, capture_output=True, text=True, timeout=30, check=True
    )
    return json.loads(result.stdout)


def validate_nodes(nodes):
    failures = []
    if {node["metadata"]["name"] for node in nodes} != set(NODES):
        failures.append("node membership differs from the reviewed three-node topology")
    for node in nodes:
        name = node["metadata"]["name"]
        if name not in NODES:
            continue
        cidr, address, _ = NODES[name]
        if node["spec"].get("podCIDRs") != [cidr]:
            failures.append(
                f"{name}: PodCIDR changed; review static routes before sync"
            )
        if not any(
            item["type"] == "InternalIP" and item["address"] == address
            for item in node["status"].get("addresses", [])
        ):
            failures.append(f"{name}: InternalIP differs from {address}")
        if not any(
            item["type"] == "Ready" and item["status"] == "True"
            for item in node["status"].get("conditions", [])
        ):
            failures.append(f"{name}: node is not Ready")
    return failures


def pod_address(node):
    return str(ipaddress.ip_network(NODES[node][0]).network_address + 10)


def route_cases(node):
    _, host, lan = NODES[node]
    local_pod = pod_address(node)
    for peer, (_, peer_host, _) in NODES.items():
        if peer == node:
            continue
        direct = node in STORAGE and peer in STORAGE
        device = "storage0" if direct else "flannel.1"
        gateway = (
            STORAGE[peer]
            if direct
            else str(ipaddress.ip_network(NODES[peer][0]).network_address)
        )
        yield f"host to {peer} pod", [pod_address(peer), "from", host], device, gateway
        yield (
            f"pod to {peer} pod",
            [pod_address(peer), "from", local_pod, "iif", "cni0"],
            device,
            gateway,
        )
        yield (
            f"pod to {peer} host",
            [peer_host, "from", local_pod, "iif", "cni0"],
            "storage0" if direct else lan,
            STORAGE[peer] if direct else None,
        )
        yield f"host to {peer} host", [peer_host, "from", host], lan, None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--preflight", action="store_true", help="check topology before applying routes"
    )
    args = parser.parse_args()
    failures = validate_nodes(query(["get", "nodes", "-o", "json"])["items"])
    observations = []
    if not failures and not args.preflight:
        pods = query(["get", "pods", "-l", "k8s-app=flannel,tier=node", "-o", "json"])[
            "items"
        ]
        for node in NODES:
            matches = [
                pod
                for pod in pods
                if pod["spec"].get("nodeName") == node
                and pod["status"].get("phase") == "Running"
                and not pod["metadata"].get("deletionTimestamp")
            ]
            if len(matches) != 1:
                raise ValueError(f"expected one running Flannel pod on {node}")
            pod = matches[0]["metadata"]["name"]
            for label, route, device, gateway in route_cases(node):
                result = query(
                    [
                        "exec",
                        pod,
                        "-c",
                        "kube-flannel",
                        "--",
                        "ip",
                        "-j",
                        "route",
                        "get",
                        *route,
                    ]
                )[0]
                observations.append({"node": node, "path": label, "route": result})
                if result.get("dev") != device or result.get("gateway") != gateway:
                    failures.append(
                        f"{node}: {label}: expected dev {device}, gateway {gateway}"
                    )
    print(json.dumps({"failures": failures, "routes": observations}, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (
        subprocess.SubprocessError,
        ValueError,
        KeyError,
        IndexError,
        OSError,
    ) as error:
        print(f"UNKNOWN: {error}", file=sys.stderr)
        sys.exit(2)

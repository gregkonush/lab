import importlib.util
import unittest
from pathlib import Path


spec = importlib.util.spec_from_file_location(
    "pod_routing", Path(__file__).with_name("verify-pod-routing.py")
)
routing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routing)


def nodes():
    return [
        {
            "metadata": {"name": name},
            "spec": {"podCIDRs": [cidr]},
            "status": {
                "addresses": [{"type": "InternalIP", "address": address}],
                "conditions": [{"type": "Ready", "status": "True"}],
            },
        }
        for name, (cidr, address, _) in routing.NODES.items()
    ]


class TopologyGateTest(unittest.TestCase):
    def test_reviewed_topology_passes(self):
        self.assertEqual(routing.validate_nodes(nodes()), [])

    def test_reallocated_podcidr_blocks_sync(self):
        changed = nodes()
        changed[0]["spec"]["podCIDRs"] = ["10.244.6.0/23"]
        self.assertTrue(
            any(
                "PodCIDR changed" in failure
                for failure in routing.validate_nodes(changed)
            )
        )

    def test_missing_node_blocks_sync(self):
        self.assertTrue(routing.validate_nodes(nodes()[:-1]))

    def test_unready_node_blocks_sync(self):
        changed = nodes()
        changed[1]["status"]["conditions"][0]["status"] = "False"
        self.assertTrue(
            any("not Ready" in failure for failure in routing.validate_nodes(changed))
        )

    def test_changed_host_address_blocks_sync(self):
        changed = nodes()
        changed[1]["status"]["addresses"][0]["address"] = "100.100.244.191"
        self.assertTrue(
            any(
                "InternalIP differs" in failure
                for failure in routing.validate_nodes(changed)
            )
        )

    def test_ryzen_routes_never_require_storage_network(self):
        for _, _, device, gateway in routing.route_cases("talos-192-168-1-194"):
            self.assertNotEqual(device, "storage0")
            self.assertNotIn(gateway, routing.STORAGE.values())

    def test_both_halves_of_each_peer_cidr_are_checked(self):
        for node, expected in (
            ("talos-192-168-1-85", {"10.244.0.10", "10.244.1.10"}),
            ("turin", {"10.244.4.10", "10.244.5.10"}),
        ):
            targets = {
                route[0]
                for _, route, device, _ in routing.route_cases(node)
                if device == "storage0"
            }
            self.assertTrue(expected.issubset(targets))

    def test_upper_half_sources_exercise_return_policy(self):
        for node, source, peer in (
            ("talos-192-168-1-85", "10.244.5.10", "100.100.244.190"),
            ("turin", "10.244.1.10", "100.100.244.142"),
        ):
            self.assertTrue(
                any(
                    route == [peer, "from", source, "iif", "cni0"]
                    and device == "storage0"
                    for _, route, device, _ in routing.route_cases(node)
                )
            )


if __name__ == "__main__":
    unittest.main()

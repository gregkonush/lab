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


if __name__ == "__main__":
    unittest.main()

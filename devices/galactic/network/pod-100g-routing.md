# Route Altra and Turin pod traffic over 100G

The [Omni template](../omni/cluster-template.yaml) owns this configuration. The two existing storage patches add
native routes between Altra and Turin. Ryzen has no connection to the CRS504 and continues to use Flannel over the LAN.

| Node                         | Node address      | PodCIDR         | Storage address |
| ---------------------------- | ----------------- | --------------- | --------------- |
| Altra, `talos-192-168-1-85`  | `100.100.244.142` | `10.244.4.0/23` | `10.100.0.11`   |
| Turin, `turin`               | `100.100.244.190` | `10.244.0.0/23` | `10.100.0.12`   |
| Ryzen, `talos-192-168-1-194` | `100.100.244.141` | `10.244.3.0/24` | None            |

Each storage bond routes the peer's two `/24` pod blocks through the peer's storage address. These prefixes take
precedence over Flannel's `/23` routes. Ordinary pod traffic, cross-node Service endpoints, and Ceph public traffic
between Altra and Turin use this path. Same-node traffic stays local. Ryzen traffic uses the existing LAN.

Policy rule `5000` matches the local PodCIDR as source and only the peer's node `/32` as destination. It selects table
`100`, whose sole route uses `storage0`. This carries replies to existing kernel Ceph clients that retain their old
node source address. Host-originated management, etcd, and Flannel VXLAN packets retain their LAN route. Pod IPs,
Service IPs, Ceph public endpoints, and MTUs do not change. Ceph's separate Multus cluster network remains in place.

The PodCIDRs are fixed inputs. Before node re-registration or address changes, update these routes, policy rules,
and the verifier together. A NIC failure can blackhole this pair's traffic until the routes are removed. The
underlying Flannel routes provide a recovery path after removal, not automatic failover.

## Apply the reviewed configuration

1. Check the [NIC sensors](README.md#read-nic-temperature), carrier, and Ceph health. Require 100,000 Mb/s on both
   ports and no new errors. Normal maintenance requires adequate cooling and full replication. The operator's
   [existing thermal exception](ceph-100g-cutover.md) does not establish safe cooling or benchmark acceptance.
2. Run the topology gate from the repository root. A failure blocks the sync.

   ```bash
   python3 devices/galactic/network/verify-pod-routing.py --preflight
   ```

3. Merge the configuration and use that exact commit. Follow the [private Omni render workflow](../omni/README.md).
   Validate both complete resulting Talos configurations for `metal` mode and dry-run a `no-reboot` apply.
   Inspect the Omni sync dry run. It must update only the two `30-<machine-uuid>-storage-network` patches.
   It must not change Ryzen, installers, extensions, node addresses, or Flannel's advertised endpoints.
4. Sync the merged template through Omni. No reboot, drain, OSD rollout, or new application attachment is required.
5. Run the route verifier. Exit `0` requires all 24 host and forwarded-pod lookups to use the expected interfaces
   and gateways. Exit `1` means a failed check. Exit `2` means evidence is unavailable.

   ```bash
   python3 devices/galactic/network/verify-pod-routing.py
   ```

6. Exercise ordinary pod connections in both directions on every node pair and DNS through the Kubernetes Service.
   Use the temporary probes below. Also exercise a cross-node application Service and existing RBD and CephFS mounts
   with write, fsync, and checksum readback. Confirm TCP packets for both directions use `storage0` on Altra and Turin.
   Route lookups and increasing aggregate counters alone do not prove the application or kernel-client path.
7. Recheck node readiness, monitor quorum, all six OSD IDs up/in, PG availability, link errors, and NIC sensors.
   Remove all probes and private exports. Repeat the Omni dry run and require no changes.

## Check ordinary pod connectivity

These temporary pods use the deployed CSI image's Python interpreter. They have no host networking, volumes, or
service-account token. Run from the repository root with access to `galactic-lan`.

```bash
for node in talos-192-168-1-85 turin talos-192-168-1-194; do
	kubectl --context galactic-lan -n rook-ceph run "pod-routing-probe-$node" \
		--image=quay.io/cephcsi/cephcsi:v3.17.1 --labels=lab-network-probe=pod-routing \
		--restart=Never \
		--overrides="{\"spec\":{\"nodeName\":\"$node\",\"automountServiceAccountToken\":false}}" \
		--command -- python3 -m http.server 8080 --directory /tmp
done
kubectl --context galactic-lan -n rook-ceph wait pod -l lab-network-probe=pod-routing --for=condition=Ready --timeout=120s
targets=$(kubectl --context galactic-lan -n rook-ceph get pods -l lab-network-probe=pod-routing -o jsonpath='{.items[*].status.podIP}')
for node in talos-192-168-1-85 turin talos-192-168-1-194; do
	kubectl --context galactic-lan -n rook-ceph exec -i "pod-routing-probe-$node" -- python3 - "$targets" <<'PY'
import socket
import sys
import urllib.request

print("DNS", socket.getaddrinfo("kubernetes.default.svc.cluster.local", 443)[0][4][0])
for address in sys.argv[1].split():
    with urllib.request.urlopen(f"http://{address}:8080/", timeout=10) as response:
        assert response.status == 200
        print("HTTP", address, response.status)
PY
done
kubectl --context galactic-lan -n rook-ceph delete pod -l lab-network-probe=pod-routing
```

If a check fails, retain the failure evidence, then delete the probes before investigating. Missing telemetry is
unknown. These small requests establish connectivity, not 100G throughput or storage latency improvement.

## Recover the LAN path

Through the existing management endpoint, remove only the three added `routes` entries and the `RoutingRuleConfig`
document from each storage patch in Git. Merge, render, validate, inspect, and sync through Omni. Retain the bonds,
addresses, Multus, and Ceph cluster-network configuration. Do not remove the entire storage patch.

Require peer pod routes to resolve through `flannel.1` and pod-to-peer-host routes through the LAN again. Repeat the
connectivity and storage checks. Removing these routes does not return Ceph replication to the LAN; that has its
own [recovery procedure](ceph-100g-cutover.md#recovery).

Schema references are Talos v1.14 [BondConfig](https://docs.siderolabs.com/talos/v1.14/reference/configuration/network/bondconfig)
and the pinned [RoutingRuleConfig implementation](https://github.com/siderolabs/talos/blob/v1.14.0/pkg/machinery/config/types/network/routing_rule.go).

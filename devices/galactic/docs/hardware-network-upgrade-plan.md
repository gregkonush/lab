# Galactic hardware and network upgrade plan

Status: Both ConnectX-5 Ex cards have reported 100G carrier. Altra has also crossed its 105 C thermal warning threshold;
resolve physical cooling before sustained traffic or Ceph cutover. The Omni template defines the two `storage0`
interfaces and host addresses. Follow the [interface setup](../network/README.md#configure-the-storage-interfaces)
and [Multus installation](../../../argocd/applications/multus/README.md). The desired Ceph configuration selects the
100G cluster network and retains the public Flannel network. The [ordered cutover](../network/ceph-100g-cutover.md)
records the operator's explicit exception to the cooling and clean-PG gates, the temporary override, and its removal.
Receipt evidence checked 2026-10-06.

## Parts received

The September network order is complete. Gmail confirms both two-item deliveries on September 30 and the switch's
UPS delivery on October 5. The prior Amazon order check established the models and matched the switch's tracking.

| Part                                        | Quantity | Delivery     | Destination                 |
| ------------------------------------------- | -------: | ------------ | --------------------------- |
| LinksTek CX516A dual-port 100GbE QSFP28 NIC |        2 | September 30 | One each in Turin and Altra |
| MikroTik XQ+DA0001, 1 m QSFP28 DAC          |        2 | September 30 | One cable per storage host  |
| MikroTik CRS504-4XQ-IN                      |        1 | October 5    | Storage switch              |

- [ ] Inspect the packages, brackets, card labels, and cable reach. Record the exact NIC SKU and firmware PSID.
      The listing says ConnectX-5 Ex, PCIe 4.0 ×16. Verify this physically; `MCX516A-CDAT` and `MCX516A-CCAT` differ.
- [ ] Check PCIe slot width, cooling, and clearance against the GPU and NVMe carrier before opening either host.

The earlier `NIC setup` conversation also proposed an RB5009 router and management LAN `10.10.0.0/24`.
That router is not among these five items; the focused Gmail search found no purchase confirmation.
Turin's CPU, RAM, GPU, and NVMe inventory belongs to its [device README](../../turin/README.md), not this new order.

## Target network

```text
Altra NIC port 1 -- DAC -- CRS504 QSFP28 port 1
Turin NIC port 1 -- DAC -- CRS504 QSFP28 port 2
```

Use one 100G link per host. Leave the second NIC ports and two remaining switch ports unused.

- Storage subnet `10.100.0.0/24`, subject to a route-conflict check. Reserve Altra `.11`, Turin `.12`, and
  `.64` through `.239` for future Ceph pod addresses. No default gateway or DHCP on this subnet.
- CRS504 does hardware L2 switching. Connect its separate Ethernet management port to the existing management LAN.
  Save a reproducible RouterOS configuration and pin the tested firmware before production use.
- Keep current management NICs, Node IPs, API access, and Tailscale working during the storage upgrade.
  The provider's `100.100.244.128/25` overlaps Tailscale address space; do not reuse it for the storage subnet.
- Keep workloads on shared Ceph. The first target moves OSD replication, recovery, and heartbeat traffic to 100G.
  Ceph's public/client network stays on Flannel. Ryzen has no purchased 100G NIC, so its client path remains a limit.

## Installation order

1. [ ] Capture a fresh baseline. Check etcd quorum, application backups, workload maintenance controls, disk identities,
       `ceph health detail`, `ceph osd tree`, pool replica settings, OSD latency, and existing link speed.
       Require six OSDs up/in and no degraded, undersized, or inconsistent PGs. Review every remaining warning.
       The October 6 readback had slow BlueStore operations and overdue scrubs; it was not `HEALTH_OK`.
2. [x] Prepare the switch using the [saved RouterOS configuration](../network/README.md).
       RouterOS and RouterBOARD firmware both report `7.23.8` after reboot. The two whole 100G ports retain hardware
       offload at MTU 1500. Management remains separate on `ether1` at `192.168.88.1/24`.
       Port 1 reports 100G with RS-FEC; port 2 has no carrier. Host identity and traffic acceptance remain in step 7.
3. [ ] Install Turin's NIC during an agreed downtime window. Pause all Ceph writers, account for local workloads,
       cordon/drain through the [storage maintenance procedure](../../../docs/runbooks/galactic-storage-and-workload-recovery.md),
       and shut down cleanly. Preserve disks and existing OSD identities.
       All live pools were `size=2`, `min_size=1`; losing one of the two OSD hosts permits writes with one surviving copy.
4. [ ] Bring Turin back. Verify boot and NVMe inventory, all three OSDs, etcd, GPU, and affected applications.
       Confirm the NIC's `mlx5_core` driver, exact firmware, PCIe link width/speed, and persistent management NIC selection.
       Wait for Ceph to regain full replication before resuming writers or opening Altra.
5. [ ] Repeat the same maintenance and recovery checks for Altra. Never maintain both OSD hosts together.
6. [ ] Add the storage interface configuration through the [Omni template workflow](../omni/README.md).
       Match the verified NIC identity, preserve complete management addressing, and render/validate/dry-run each host change.
       Both MAC-selected ports feed real single-port `storage0` bonds for a consistent macvlan CNI master name.
       Do not apply retained per-device patches directly.
7. [ ] Verify 100,000 Mb/s on both NICs and switch ports, matching FEC, stable carrier, and clean error counters.
       Run interface-bound TCP `iperf3` tests in both directions with parallel streams for 60 seconds.
       Save measured throughput, retransmits, CPU use, and negotiated PCIe capacity. Explain any ceiling before Ceph cutover.
       Keep MTU 1500 for the first cutover; test MTU 9000 separately after the whole storage path passes.

## Move Ceph traffic only after the migration gate

The live cluster uses Rook `v1.20.7`, Ceph `20.2.4`, and the default pod network. Both OSD public and cluster addresses
are still `10.244.*`. Installing NICs or setting host IPs does not move that traffic.

- [ ] Prepare one reviewed migration procedure for cluster-only Multus, with macvlan on the new NIC and Whereabouts
      addresses from the reserved range. Leave the public selector unset. Verify Talos CNI paths, plugin installation,
      persistent interface naming, and OSD-to-OSD connectivity before selecting the network in Rook.
- [ ] Resolve the upstream support constraint before production. Rook's [v1.20 CRD reference](https://rook.io/docs/rook/v1.20/CRDs/Cluster/ceph-cluster-crd/#network-configuration)
      warns that deployed network changes other than encryption are unsupported. Its [network-provider guide](https://rook.io/docs/rook/v1.20/CRDs/Cluster/network-providers/)
      describes careful network changes. Do not treat that guide as approval for an in-place provider conversion.
      Establish an upstream-supported route and rehearse it with the same versions, including mixed old/new pod connectivity
      and recovery. If none exists, stop at tested hardware; a data-preserving replacement needs a separate capacity and restore plan.
- [ ] Merge and validate the selected GitOps changes before an authorized cutover. Preserve pools, PVCs, CRUSH placement,
      OSD IDs, and disks. No CephCluster deletion, OSD purge, or disk zap belongs to this plan.
- [ ] Prove every OSD advertises a `10.100.0.*` cluster address and its existing public path still works.
      Verify traffic counters on the 100G ports during real writes, then CephFS/RBD write, fsync, and readback from every node.
      Compare latency and throughput with the same baseline workload. A 100G carrier does not prove a 100G Ceph path.

The network block in `argocd/applications/rook-ceph/cluster-values.yaml` is below. The existing `connections`
settings remain configured. Runtime acceptance requires the address, traffic, and data readback checks above.

```yaml
cephClusterSpec:
  network:
    provider: multus
    selectors:
      cluster: rook-ceph/ceph-cluster-100g
    addressRanges:
      cluster:
        - 10.100.0.0/24
```

## Follow-up and recovery

- [ ] Recheck Talos and Kubernetes through the [current release procedure](../releases/README.md).
      All three live nodes already report Talos `1.14.0` and Kubernetes `1.37.0`; do not combine another OS upgrade with NIC installation.
- [ ] Handle the optional RB5009 management-LAN move in a separate window after storage acceptance and router availability.
      Prepare reservations, BMC access, etcd/kubelet subnet selectors, API certificates/LB, Omni installer registry,
      MetalLB VIPs, Pi-hole DNS, and Tailscale routes together. Retire the old lab addressing after acceptance.
- [ ] Before each change, retain the previous Omni template and switch export privately. For a hardware/link failure,
      return the affected host to its original management path and verify disks, quorum, and Ceph before resuming writes.
      The Ceph migration procedure must prove its own recovery path; reverting one network field is not a recovery plan.

Remaining: resolve Altra's cooling and finish traffic and data acceptance. Record PCIe capacity, switch peer
identities, measured throughput, and latency. Use the ordered cutover for any resumed migration.
Check off a step only after its stated proof passes. Keep credentials, raw email, order numbers, and tracking IDs out of Git.

Hardware references: [CRS504](https://mikrotik.com/product/crs504_4xq_in),
[DAC](https://mikrotik.com/product/xq_da0001), [NIC variants](https://networking-docs.nvidia.com/connectx5enhw).

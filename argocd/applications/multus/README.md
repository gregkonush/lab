# Secondary pod networking

This application installs Multus `4.3.1` in daemon mode, Whereabouts `0.9.4`, and the macvlan plugin from
Sidero's CNI `1.9.0` image. Images are pinned to multi-architecture manifest digests covering amd64 and arm64.
The upstream manifests and CRDs are pinned to release tags. ApplicationSet `bootstrap` owns the application in
`kube-system`.

Multus automatically delegates the primary network to the existing `10-flannel.conflist`. Existing pod networks
remain in place. Only pods explicitly selecting a NetworkAttachmentDefinition receive a secondary interface.
The macvlan init container installs only `macvlan`; it does not replace Talos's Flannel, bridge, or IPAM binaries.
Whereabouts maintains cluster-wide address leases and cleans up stale allocations.

Ceph's [storage network](../rook-ceph/storage-network.yaml) reserves `10.100.0.64` through `10.100.0.239` on
the real `storage0` link. The [Omni template](../../../devices/galactic/omni/cluster-template.yaml) creates that
single-port bond on Altra and Turin. Physical ports are selected by permanent MAC, independently of PCIe slot names.
This installs the secondary network; it does not change Ceph's network provider or restart its OSDs.

## Deploy and verify

1. Render `kustomize build argocd/applications/multus` and validate the output. Child applications must not render
   Namespace objects.
2. Merge the reviewed changes. Sync the affected `bootstrap` ApplicationSet through the root Application, then
   sync `multus` to that exact merge commit if automatic reconciliation has not completed.
3. Require both DaemonSets to be ready on all three nodes and the single Whereabouts reconciler to be available.
   The reconciler reclaims leases left behind when CNI DEL cannot run after pod or node loss.
   Check for CNI errors before proceeding:

   ```bash
   kubectl --context galactic-lan -n kube-system get daemonsets kube-multus-ds whereabouts
   kubectl --context galactic-lan -n kube-system get deployment whereabouts-reconciler
   kubectl --context galactic-lan -n kube-system logs daemonset/kube-multus-ds -c kube-multus --tail=50
   talosctl --context ryzen --endpoints 100.100.244.141 --nodes 100.100.244.142,100.100.244.190 ls /opt/cni/bin
   ```

4. Sync the existing `rook-ceph` Application's reviewed NetworkAttachmentDefinition. Verify a newly created
   ordinary pod still receives its Flannel address and reaches cluster DNS and Services.
5. Validate secondary networking between diagnostic pods on Altra and Turin before selecting it for Ceph.
   Follow the [100G migration gates](../../../devices/galactic/docs/hardware-network-upgrade-plan.md#move-ceph-traffic-only-after-the-migration-gate).

To recover from a broken Multus installation, first remove secondary network requests from affected workloads and
verify their default-network replacements. Restore the previous version through GitOps. Deleting the DaemonSet
alone is insufficient because CNI binaries and configuration live on the host. Keep the NetworkAttachmentDefinition
CRD and Whereabouts allocation records while any pod still uses them.

Sources: [Talos Multus guide](https://docs.siderolabs.com/kubernetes-guides/cni/multus),
[Multus deployment](https://github.com/k8snetworkplumbingwg/multus-cni/tree/v4.3.1/deployments),
[Whereabouts](https://github.com/k8snetworkplumbingwg/whereabouts/tree/v0.9.4).

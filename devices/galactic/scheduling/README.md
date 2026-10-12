# Move Ceph clients off Ryzen and place CI on local storage

Ryzen is `talos-192-168-1-194`. Its Bosgame M5 chassis cannot provide a practical full-rate
100G NIC expansion path. See the [hardware evidence](../../ryzen/docs/bosgame-m5-talos-drivers.md#network-expansion-and-workload-placement).

Omni owns `network.proompteng.ai/100g=true` on Altra and Turin, and `false` on Ryzen.
Ryzen also has `workload.proompteng.ai/compute-local=true` and the matching
`true:NoSchedule` taint. A bandwidth-sensitive workload can require the 100G label
after the labels exist. The taint keeps application Ceph clients off Ryzen without
changing every operator-generated Pod template.

The `local-path` application owns the native `compute-local` MutatingAdmissionPolicy.
It adds the compute-local toleration to Pods without named PVCs or Ceph volume sources.
Generic ephemeral PVCs qualify only with an explicit local-path class from the policy's
allowlist. Missing PVCs and unspecified ephemeral classes do not qualify. Existing
tolerations, selectors, and affinity remain intact. This policy requires the cluster's
Kubernetes 1.37 API and no additional admission service.

Named local PVC consumers must opt in explicitly after verifying their class and bound PV.
Bayn's local-path TigerBeetle cluster moves to Altra and Turin and must not retain that opt-in. Do not add the toleration or a
blanket `Exists` toleration to applications with Ceph volumes. This taint is a scheduling
contract for reviewed workloads, not an authorization boundary against arbitrary Pod specifications.

DaemonSets need tolerations in their templates because their controller filters nodes
before Pod admission. The node networking, identity, metrics, GPU, and virtualization
agents retain Ryzen eligibility through their committed templates or existing tolerations.

Ceph's own services are exempt. Rook, its monitors, manager, exporters, and CSI components
remain eligible on Ryzen. The monitor placement retains all three hosts with
`allowMultiplePerNode: false`. No OSD disk placement or Ceph replication configuration changes.

## Check the migration before applying it

1. Confirm `galactic-lan` identity through the [access runbook](../../../docs/runbooks/galactic-kubernetes-access.md).
2. Run `python3 devices/galactic/scheduling/verify-placement.py --context galactic-lan` to list current Ceph clients on Ryzen.
3. Run `python3 devices/galactic/scheduling/verify-placement.py --context galactic-lan --probe-admission` to exercise
   the actual API's mutation logic. It creates a UUID-named policy and binding scoped to a unique test label in
   `local-path-storage`, submits only server-dry-run Pods, and removes both policy objects in a `finally` block.
   No application Pod or existing policy is changed. This probe requires PyYAML and cluster policy creation permissions.
4. Check fresh Altra and Turin NIC temperatures and run the [100G routing acceptance](../network/README.md).
   Require temperatures below the reported critical threshold before adding client traffic. Historical peaks do not
   establish the current temperature, and a negotiated 100G link alone does not prove sustained operation.
5. Keep the existing CPU/GPU memory split for the initial ARC move. Ryzen has 128GiB installed, with 64GiB reserved
   for the GPU and 61.8GiB allocatable. Place at most two AMD64 runners there, and retain three on Turin. Each runner
   reserves 16Gi and four logical CPUs. The 2026-10-11 inventory projects about 46.95GiB and 15.78 logical CPUs for
   retained workloads plus two runners after application Ceph clients and all Bayn components leave Ryzen. Verify
   fresh requests and local filesystem free space before promotion. A later all-five move requires the
   [Bosgame memory repartition](../../ryzen/docs/bosgame-m5-talos-drivers.md#cpu-and-gpu-memory-allocation).

Three Ceph-backed database clusters, SPIRE server, and Restate retain three replicas but use preferred host separation
because only two application storage-client hosts remain. Bayn PostgreSQL must retain one instance on Altra and one
on Turin with required host separation; both architecture images must be validated before that rollout. Bayn status,
execution workers, and egress likewise span those hosts. Its three TigerBeetle replicas use a two-plus-one placement
across them, preserving replica identity and local data during the Ryzen handoff. No Bayn component belongs on Ryzen.
Torghut PostgreSQL currently retains its AMD64 restriction, so its two instances can share Turin. Preserve database
synchronous replication and writer fences; replica count is not the physical failure-domain count.

## Apply the reviewed desired state in order

Merge the storage and scheduling preparation first. Keep the dependent ARC runner-placement PR in draft until steps
1 through 5 pass. Changes under `argocd/applications/arc/**` automatically build an image and enter Kargo promotion;
merging before its local class and memory headroom exist can strand the Ryzen pool and reduce available AMD64 build capacity.

1. Verify the exact merged revision and required CI. Reconcile the reviewed Rook and node-agent changes through their
   existing Argo applications. Confirm Ryzen's Ceph monitor remains in the three-monitor quorum and its node agents are ready.
2. Sync the manual `local-path` application to that revision. Require `local-path-ryzen`, the admission policy, and its binding
   to exist before changing Ryzen's scheduling configuration. The new class uses the existing XFS user volume at
   `/var/mnt/local-path-provisioner` with `WaitForFirstConsumer` and Ryzen-only topology.
3. Reconcile the reviewed database, SPIRE, and Restate affinity changes through their owning GitOps branches. Confirm all
   replicas are ready before moving any existing storage client. Kargo-managed applications use their Stage-generated branch.
4. Render, validate, dry-run, and sync the reviewed Omni template using the [Omni procedure](../omni/README.md).
   Preserve existing node IP configuration and labels. Require the 100G labels on Altra and Turin and the compute-local taint on Ryzen.
5. Move the inventoried Ceph client Pods one at a time through their operator's supported maintenance procedure.
   `NoSchedule` does not evict existing Pods. Respect PDBs, database switchover, Kafka quorum, CSI detach, and each workload's
   readiness before continuing. Cassandra retains its intentional `OnDelete` strategy. Do not drain Ryzen, delete PVCs,
   force detach volumes, or restart Ceph's monitor to perform this migration. A running Coder workspace needs its owner's
   maintenance window before its Ceph-backed Pod is recreated.
6. Keep Forgejo's AMD64 runner on Turin with its original Ceph registration PVC. Drain assigned jobs through the
   [Forgejo runner procedure](../../../argocd/applications/forgejo-runners/README.md) before its move.
7. Promote the reviewed ARC configuration through the existing `arc-runner` Kargo Stage after Ceph clients have left Ryzen.
   Keep the ARM64 sets on Altra. Let busy AMD64 runners finish normally. The Turin pool retains its Transcend class
   and cap of three; the new Ryzen pool uses `local-path-ryzen` and a cap of two. Both advertise `arc-amd64`.
8. Run `python3 devices/galactic/scheduling/verify-placement.py --context galactic-lan --verify`.
   Require no application Ceph client on Ryzen, an AMD64 runner using only its local scratch claim, and the Ryzen monitor in quorum.
   Execute a non-publishing AMD64 CI job that writes scratch files, builds and runs a container, and executes Nix binaries.
   Check Ryzen etcd latency, memory pressure, CPU contention, and scratch I/O during two concurrent Ryzen builds and three concurrent Turin builds.
   Its local scratch partition shares the physical NVMe with `/var`.

## Recover an interrupted rollout

Stop moving additional clients if quorum, readiness, or volume attachment checks fail. Preserve all claims and registrations.
For a placement regression, revert the reviewed Omni taint patch and affected GitOps configuration through their owners,
then verify node eligibility and restore unavailable replicas one at a time. Removing `NoSchedule` makes Ryzen eligible;
it does not move already running Pods. Reduce ARC capacity through its reviewed Kargo path if local disk or memory pressure
affects the control plane. Never delete busy runner Pods to reduce concurrency.

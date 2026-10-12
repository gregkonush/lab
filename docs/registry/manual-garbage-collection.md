# Registry manual garbage collection

The registry uses Deployment `registry`, PVC `registry-data`, and ConfigMap
`registry-config` in namespace `registry`. Collection runs against the existing
filesystem at `/var/lib/registry`. Use a read-only maintenance window so pulls
remain available while pushes are rejected.

The former scale-to-zero Job procedure is retired. Argo self-heal could recreate
a writable registry during collection. The prune CLI also no longer supports GC
or registry restart flags.

## Prepare and acquire the hold

Confirm one ready registry Pod, a Bound claim, a settled Argo revision, and no
active sync or other maintenance owner. Record the Application UID, PVC UID/PV,
registry node, original replica count, and any existing read-only or node override.
Stop if those overrides indicate unfinished maintenance.

Retain at least five recent version tags per repository, uploads from the last
seven days, live workload references, and retained Kargo Freight, Stage history,
and promotions. Resolve image indexes through their platform manifests and
attestations. Before `--delete-untagged`, every protected digest must remain
reachable from a retained tag and all referenced blobs must exist. Freeze and
repeat that audit after writes have stopped.

The owning bootstrap ApplicationSet must preserve both maintenance annotations.
Take the hold atomically, with UID and resourceVersion preconditions:

```bash
set -euo pipefail
LAB_REGISTRY_CONTEXT=galactic-lan
LAB_REGISTRY_HOLD="registry-gc-$(uuidgen)"
LAB_REGISTRY_APP="$(kubectl --context "$LAB_REGISTRY_CONTEXT" -n argocd get application registry -o json)"
printf '%s' "$LAB_REGISTRY_APP" | jq -e '
  .operation == null and .status.sync.status == "Synced" and
  .metadata.annotations["argocd.argoproj.io/skip-reconcile"] == null and
  .metadata.annotations["storage.proompteng.ai/ceph-remount-owner"] == null
' >/dev/null
LAB_REGISTRY_UID="$(printf '%s' "$LAB_REGISTRY_APP" | jq -r .metadata.uid)"
LAB_REGISTRY_PATCH="$(printf '%s' "$LAB_REGISTRY_APP" | jq --arg owner "$LAB_REGISTRY_HOLD" '[
  {op:"test",path:"/metadata/uid",value:.metadata.uid},
  {op:"test",path:"/metadata/resourceVersion",value:.metadata.resourceVersion},
  {op:"add",path:"/metadata/annotations/argocd.argoproj.io~1skip-reconcile",value:"true"},
  {op:"add",path:"/metadata/annotations/storage.proompteng.ai~1ceph-remount-owner",value:$owner}
]')"
kubectl --context "$LAB_REGISTRY_CONTEXT" -n argocd patch application registry --type=json -p "$LAB_REGISTRY_PATCH"
```

Save the owner and recovery values locally. If a precondition fails, read fresh
state before retrying. Verify both annotations survive ApplicationSet
reconciliation. While held, Argo status is stale; use native workload readback.

## Collect with writes disabled

1. Keep the registry on its current node while a maintenance Pod shares the RWO
   claim. Add a temporary `nodeName` and set
   `REGISTRY_STORAGE_MAINTENANCE_READONLY={"enabled":true}` on the registry
   container. Supply the entire map value: Distribution 3.1.1 requires this map
   when the mounted configuration has no `maintenance.readonly` section. Verify
   the setting with the pinned image against an empty temporary filesystem before
   the production restart. Wait for the `Recreate` rollout to finish.
2. Require `GET /v2/` to return 200 and upload initiation
   (`POST /v2/ceph-smoke/registry-gc-check/blobs/uploads/`) to return 405.
   A 202 response means writes are still enabled: stop before collection.
3. Use a maintenance Pod on the same node, with the exact deployed registry image,
   `registry-data` mounted read/write at `/var/lib/registry`, and `registry-config`
   mounted read-only at `/etc/docker/registry`. Give it no service-account token,
   no added capabilities, and a read-only container root. Validate its manifest
   before creation. Repeat the frozen protected-reference audit against this mount.
4. Run one collector, using the mounted configuration:

   ```sh
   registry garbage-collect --delete-untagged /etc/docker/registry/config.yml
   ```

   Keep its output and exit status. An exec disconnect does not prove the collector
   stopped. Keep writes disabled until its process has exited or its maintenance
   Pod has been deleted and deletion confirmed.
5. Repeat the protected-reference and blob audit after collection. Record claim
   free space. If the filesystem lacks `discard`, trim only this claim's verified
   CSI global mount from the existing privileged RBD CSI node container. Match
   the CSI volume handle and device before `fstrim`; do not trim other filesystems.

## Restore and verify

Delete the maintenance Pod and confirm deletion before removing the temporary
node pin or restoring writes. This prevents RWO multi-attach and ensures no
collector can continue alongside uploads. Restore the original Deployment values,
wait for readiness, and verify the original PVC UID/PV is unchanged. If helper
termination or restoration fails, retain the hold and recovery receipt.

Release only this operation's annotations, checking the saved UID and owner:

```bash
LAB_REGISTRY_PATCH="$(jq -n --arg uid "$LAB_REGISTRY_UID" --arg owner "$LAB_REGISTRY_HOLD" '[
  {op:"test",path:"/metadata/uid",value:$uid},
  {op:"test",path:"/metadata/annotations/storage.proompteng.ai~1ceph-remount-owner",value:$owner},
  {op:"remove",path:"/metadata/annotations/argocd.argoproj.io~1skip-reconcile"},
  {op:"remove",path:"/metadata/annotations/storage.proompteng.ai~1ceph-remount-owner"}
]')"
kubectl --context "$LAB_REGISTRY_CONTEXT" -n argocd patch application registry --type=json -p "$LAB_REGISTRY_PATCH"
```

Verify fresh Argo reconciliation, a new push, a full retained-image pull, the
protected digests, and free capacity on the existing claim. Remove owned test tags.

See [ApplicationSet maintenance holds](../../argocd/applicationsets/README.md#storage-maintenance-holds)
and [Distribution's collection requirements](https://distribution.github.io/distribution/about/garbage-collection/).

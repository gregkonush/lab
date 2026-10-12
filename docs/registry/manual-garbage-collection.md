# Registry cleanup

Use the existing `registry-data` claim in namespace `registry`. Cleanup has three
phases: prepare with uploads open, quarantine under a bounded read-only hold, then
physically delete quarantined files with uploads open. Do not run Distribution's
full `--delete-untagged` scan under an unbounded maintenance window.

The former `prune-images.ts` CLI is removed. Its creation-date ordering, bare-hash
tag matcher and manifest-digest deletion are replaced by upload-time retention,
current build-tag recognition, explicit protections and tag removal.

## Prepare with uploads open

Use Python 3.14 and an authenticated `kubectl`. Record the existing PVC UID/PV,
registry node and Application UID. Stop if another maintenance owner, node pin,
read-only override or Argo sync is active. Keep the existing claim.

Run preparation from the repository root:

```sh
python3 packages/scripts/src/registry/prepare.py \
  --context galactic-lan --plan /tmp/registry-plan.json \
  --references /tmp/registry-references.json
```

The runner snapshots workload and retained Kargo references. It creates a pinned
Python helper on the current registry node with the existing claim mounted
read-only, verifies transferred input hashes, saves the plan locally and deletes
the helper. It records the claim UID/PV in the plan. It never changes registry
files or disables uploads. Preparation fails on unsupported manifests or missing
retained content.

Keep at least five recent build tags per repository, all uploads from the last
seven days, unknown human tags, live workload references and retained Kargo
Freight, Stage history and promotions. Retain every platform and attestation
reachable from those roots. Recent untagged manifests also retain their layers.
The plan records file identities, upload timestamps, manifest bytes and candidate
sizes. Cached manifests are checked against their content digest before reuse.

## Quarantine within four minutes

Refresh protection references immediately before collection, then run:

```sh
python3 packages/scripts/src/registry/protected_references.py \
  --context galactic-lan --output /tmp/registry-references.json
python3 packages/scripts/src/registry/collect.py \
  --context galactic-lan --plan /tmp/registry-plan.json \
  --references /tmp/registry-references.json --seconds 240 --max-blobs 2000
```

The controller creates an owned helper on the current registry node and verifies
input hashes. It acquires the Application hold with UID/resourceVersion checks,
pins the registry to that node and sets the complete override
`REGISTRY_STORAGE_MAINTENANCE_READONLY={"enabled":true}`. The bootstrap
ApplicationSet must preserve the hold and owner annotations.

Collection requires `GET /v2/` = 200 and upload initiation = 405. It rereads current
tags, recent manifests and fresh protections, recomputes retention, validates the
complete retained graph and rejects changed candidates. A prepared tag remains
eligible only if five newer build tags still exist. Human tags and recent uploads
cannot be selected by editing the plan.

Eligible tag directories and verified orphan blobs move atomically into
`docker/registry/v2/_gc_quarantine/<batch>/<digest-prefix>/<digest>` on the same
claim; tag metadata uses `tags/<hash-of-repository-and-tag>` inside that batch.
A durable receipt records the selected tags and original blob file identities.

Renaming keeps the allocated blocks intact. Neither blob payloads nor tag metadata
are physically deleted while uploads are disabled. Empty CAS directories and historical
revision/layer links can remain; they do not retain the removed blob payloads.

The collection deadline includes read-only rollout and frozen validation. On
completion, failure or timeout, the controller deletes its helper and confirms
deletion **before** restoring uploads and removing its owned Argo hold. Deployment
restoration has a separate readiness timeout. If helper deletion cannot be
confirmed, it leaves writes disabled and the hold intact. Never infer process
exit from an exec disconnect. A timeout can leave a partial quarantine batch;
its receipt remains valid for online deletion.

The result records the quarantine identifier and moved bytes. The controller
checks the PVC UID/PV is unchanged. Verify a completed push and a full retained-image
pull after restoration. Source changes to the upload budget require their separate
shared-storage qualification.

## Reclaim blocks online

After uploads are restored, use the identifier from collection:

```sh
python3 packages/scripts/src/registry/purge.py \
  --context galactic-lan --quarantine-id registry-collect-<identifier> \
  --output /tmp/registry-purge.log
```

This creates a one-off Job with eight deletion workers. Its PVC mount exposes only
`docker/registry/v2/_gc_quarantine` at `/quarantine`. It has no mount of the live CAS,
no service-account token and no added capabilities. Reuploading the same digest
creates a new live file; deleting the quarantined inode cannot remove it.

The Job verifies each receipt's inode, size and timestamp before deleting blobs,
and validates quarantined tag links before deleting their metadata.
Absent quarantined files are safe to skip on retry. A failed or interrupted purge
preserves the receipt and remaining files. Retry the same batch after inspecting
its Job; do not delete live blobs or change the claim. Successful Jobs and their
script ConfigMaps are removed by the runner. Failed Jobs retain diagnostic evidence.

After deletion, audit protected references and blob sizes, pull a retained image,
and read filesystem free space. If the mount lacks `discard`, trim only this
claim's verified CSI global mount. Match the PV's CSI volume handle and ext4 RBD
device before `fstrim`; never trim an unrelated filesystem. Do the trim with
registry writes enabled. Report filesystem free-space change separately from
RBD trim output and physical Ceph capacity.

See [ApplicationSet maintenance holds](../../argocd/applicationsets/README.md#storage-maintenance-holds)
and [Distribution's GC requirements](https://distribution.github.io/distribution/about/garbage-collection/).

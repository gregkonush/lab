# Private registry

The registry keeps its existing single `registry-data` claim. HAProxy shares one
5 MiB/s upload budget across every mutation using a constant stick-table key.
Up to 32 blob requests can stream concurrently. Serializing them behind one
writer makes cold image/cache uploads wait long enough for clients to disconnect.

Manifest commits use a separate four-connection backend, and image reads use the
existing 100-connection backend. Client/server inactivity remains bounded at five
minutes. This bounds incoming payload traffic; it is not a bound on filesystem
metadata operations or total Ceph I/O.

The generated proxy ConfigMap has a content hash. Merge through required checks;
Argo rolls the existing single replica with its `Recreate` strategy. Expect a brief
registry interruption during that rollout. Keep image consumers on immutable
published artifacts. Recovery uses a reviewed Git revert and normal Argo sync;
do not change the claim or delete uploaded blobs.

Validate the traffic boundary with the deployed HAProxy version in an isolated
container. A slow upload holds its request open for eight seconds while three
8 MiB uploads run. The fixture uses four proxy threads. The test checks digests, completion before the slow request, the aggregate
upload budget, and concurrent read access.

```sh
docker build -f argocd/applications/registry/tests/Dockerfile -t registry-pacing-test argocd/applications/registry
docker run --rm --network none --read-only --cap-drop ALL --tmpfs /tmp --memory 128m --cpus 1 --pids-limit 128 registry-pacing-test
```

The same test fails with the former single-writer configuration and with a
per-stream limiter combined with concurrent writers.

## Clean old images

Keep at least five recent build tags per repository, every image uploaded in the
last seven days, and all digests referenced by workload templates or retained Kargo
Freight, Stage history, and promotions. Preserve the platform manifests and
attestations reachable from retained image indexes. Leave unknown tags alone.
Retention recognizes bare hashes, `sha-*`, `kargo-sha-*` and run-qualified build tags.

Use the [cleanup runbook](../../../docs/registry/manual-garbage-collection.md).
Preparation runs while uploads remain available. An owned maintenance hold limits
the final read-only phase to validating current roots and atomically moving eligible
tags and old unreferenced blobs into quarantine. The controller removes its helper before
restoring uploads and Argo reconciliation. The committed maintenance container has
a read-only CAS mount and a writable quarantine subpath. It prepares plans and
frees quarantined blocks online without a separate RWO attachment. Preserve the claim and verify protected images, a
completed push, a full pull and reclaimed capacity.

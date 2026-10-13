# Bayn Valkey cluster

Dedicated native Valkey Cluster, managed by chideat/valkey-operator v2.1.0.
The `bayn-valkey` product Application tracks reviewed `main` independently of the
Kargo-owned Bayn execution release. Its resources live in the existing `bayn`
namespace; it does not own namespace metadata, restart Bayn, change trading
authority, or replace PostgreSQL, TigerBeetle or Kafka.

## Topology and capacity

- Valkey 9.1 release family through the operator's supported `Valkey` API.
  The operator resolves data/helper images; record their actual digests during
  rollout. The isolated acceptance client is pinned to Valkey 9.1.2 by digest.
- Three shards, each with one primary and one replica: six data pods.
- Per pod: 1Gi memory request/limit, 512Mi maximum dataset, 10Gi RBD PVC.
- AOF persistence with `appendfsync everysec`; memory pressure rejects writes
  rather than evicting data. Replication and AOF are not zero-loss guarantees.
- Each shard is spread across Bayn's two 100G hosts. This is not three independent
  failure domains: losing the host containing a majority of primaries can stop
  the cluster. No placement or taint is changed on the reserved compute host.

The Cluster is protected from Argo pruning/deletion. On v2.1.0,
`retainAfterDeleted: true` adds a Cluster owner reference to PVC templates, so it
is deliberately false here. Verify that the resulting PVCs have no Cluster owner
references. Do not delete the PVCs: the underlying StorageClass uses `Delete`.
This deployment does not add a backup schedule.

## Connection

Seed endpoint: `bayn-valkey.bayn.svc.cluster.local:6379`, TLS, cluster-aware client.
Username: `default`. Password: Secret `bayn-valkey-auth`, key `password`.
Client certificate/key and CA: Secret `bayn-valkey-client-tls`, keys `tls.crt`,
`tls.key`, `ca.crt`. Connection metadata is in `bayn-valkey-connection`.
Use Secret references, never inline credentials or log their contents.

The operator's User webhook limits passwords to 32 characters and requires
letters, digits and special characters. Generate a 32-character credential in
memory and seal it into `auth-sealedsecret.yaml`, preserving the Secret name and
namespace. A synced SealedSecret does not prove User admission; verify the User
and the authenticated acceptance Job after reconciliation.

The application ACL permits normal data operations only under `bayn:*`, with
cluster discovery and no destructive administration. The controller's separate
operator credential is not an application credential. NetworkPolicy permits
Bayn clients and the operator on 6379, cluster peers on 6379/16379, and the
existing metrics collector on 9121. Helpers may reach only DNS and the configured
Kubernetes API endpoints outside their peers.

No Bayn process currently consumes Valkey. Connecting a specific application
feature requires a subsequent reviewed code/configuration change through Bayn's
normal Kargo path. This cluster's mere presence changes no application behavior.

## Acceptance and recovery

`bayn-valkey-acceptance-v1` is a bounded, tokenless Job using only the new client
credential. It verifies TLS, cluster readiness, writes/reads across hash tags,
key-prefix rejection and unauthenticated rejection. Synthetic keys expire after
ten minutes and successful checks delete them immediately. Retain the completed
Job for its result; it consumes no running compute after completion.

```sh
kustomize build argocd/applications/bayn-valkey > /tmp/bayn-valkey.yaml
bash scripts/kubeconform.sh /tmp/bayn-valkey.yaml
kubectl -n bayn get clusters.valkey.buf.red bayn-valkey
kubectl -n bayn get pods,pvc -l buf.red/name=bayn-valkey
kubectl -n bayn logs job/bayn-valkey-acceptance-v1
```

For upgrades, keep the Valkey release family and operator compatible, inspect the rendered
diff and follow reviewed GitOps. Never roll back by deleting the Cluster or its
PVCs. A failed acceptance Job is not a passed rollout. Do not broaden its network
permissions or use an operator/broker credential to make acceptance pass.

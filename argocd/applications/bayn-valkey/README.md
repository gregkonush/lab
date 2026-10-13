# Bayn Valkey

Dedicated Valkey 9.1 primary and replica, managed by chideat/valkey-operator v2.1.0.
The `bayn-valkey` Application tracks reviewed `main` independently of Bayn's Kargo
release. Valkey is a disposable cache; PostgreSQL, TigerBeetle and Kafka retain
their existing authority.

## Topology and availability

`valkey.yaml` selects `arch: replica`, one shard and two data pods. Required
anti-affinity places one pod on each eligible 100G host. Each requests 1Gi of
memory, caps the dataset at 512Mi and owns a 10Gi Ceph RBD volume. AOF uses
`appendfsync everysec`; `noeviction` rejects writes at capacity.

There is no Sentinel or automatic promotion. A failed primary makes the cache
unavailable until recovery or an operator-managed manual promotion. Cache users
must bound requests and use their authoritative source on cache transport
failure. A replica alone does not guarantee automatic HA across two hosts.
Automatic failover requires independent voters; this deployment does not place
workloads on the reserved compute host or change its taints.

## Connection and access

- Primary: `rfr-bayn-valkey-readwrite.bayn.svc.cluster.local:6379`.
- Replica: `rfr-bayn-valkey-readonly.bayn.svc.cluster.local:6379`.
- TLS trust and client identity: Secret `bayn-valkey-client-tls`.
- Username: `default`; password: Secret `bayn-valkey-auth`, key `password`.
- Connection metadata: ConfigMap `bayn-valkey-connection`.

The application ACL permits data commands under `bayn:*` and bounded replication
acknowledgement with `WAIT`. It grants no cluster discovery or destructive
administration. The operator account remains separate. Passwords must contain
letters, digits and special characters and fit the operator's 32-character
limit. Generate replacements in memory and update only the encrypted value in
`auth-sealedsecret.yaml`, preserving Secret identity and strict sealing scope.
A synced SealedSecret does not prove User admission.

## Acceptance

The bounded, tokenless `bayn-valkey-acceptance-v2` Job uses only the application
credential. It writes to the primary, waits for one replica acknowledgement on
the same connection, reads the replicated value and removes the synthetic key.
It also checks key-prefix rejection and rejection without a password. Keys
expire after ten minutes if the Job is interrupted.

```sh
kustomize build argocd/applications/bayn-valkey > /tmp/bayn-valkey.yaml
bash scripts/kubeconform.sh /tmp/bayn-valkey.yaml
kubectl -n bayn get valkeys.rds.valkey.buf.red,failovers.valkey.buf.red
kubectl -n bayn get pods,pvc -l buf.red/name=bayn-valkey
kubectl -n bayn logs job/bayn-valkey-acceptance-v2
```

## Migration from the unused sharded cluster

The three original primaries were checked with the existing TLS application
credential and each reported `DBSIZE=0`. No Bayn process consumed that cluster.
Changing `arch` in place does not retire the operator's old Cluster child.
After merging and passing validation, run one scoped Argo synchronization at
the reviewed revision with `Force=true` and `Replace=true` for the Valkey,
`replica-acl-bayn-valkey-default` User and acceptance-v2 Job. Do not persist those
force options as Application automation or resource annotations.

Before replacement, verify the Valkey has no `delete-pvc` finalizer and all six
old PVCs have no Cluster owner references. Replacement retires the old child
Cluster and six pods. The six old `valkey-data-drc-bayn-valkey-*` volumes remain
retained for recovery; do not delete them during this rollout. Verify the new
Failover child is Ready, exactly two data pods run on separate hosts, the old
Cluster and old User are absent, and acceptance-v2 succeeds. Argo must converge
to Synced/Healthy at the reviewed revision.

Recovery uses a reviewed source reversion and the same scoped replacement; the
retained old volumes remain available. Never prune volumes, relax ACLs or use an
operator credential to make an acceptance test pass. Cache availability does
not grant broker, strategy or capital authority.

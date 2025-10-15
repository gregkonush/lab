# Observability Object Storage Reset

This flow refreshes the MinIO tenant credentials that back Grafana Mimir, Loki, and Tempo, reseals the secrets, and restarts the workloads so they pick up the new keys.

> **Sensitive output** – several steps print newly-generated credentials. Capture them securely and rotate any external systems that depend on them.

## 1. Generate fresh secrets

```
./scripts/generate-observability-minio-secrets.ts --print-values
kubectl apply -f argocd/applications/minio/observability-minio-secret.yaml
kubectl apply -f argocd/applications/observability/minio-secret.yaml
```

- The Bun script emits `export MINIO_ROOT_USER=…` statements so the MinIO operator accepts the `config.env`.
- Commit the updated SealedSecret manifests after confirming the cluster changes.

## 2. Restart the MinIO tenant

```
kubectl -n minio rollout restart statefulset observability-pool-0
kubectl -n minio rollout status statefulset observability-pool-0
```

Wait until `observability-pool-0-*` pods report `2/2 Running`.

## 3. Recreate users and buckets

```
kubectl apply -f argocd/applications/observability/minio-buckets-job.yaml
kubectl -n observability logs job/observability-minio-buckets -f
kubectl -n observability delete job observability-minio-buckets
```

Ensure the log shows successful creation of MinIO users (Loki, Tempo, Mimir) and buckets (loki-data, tempo-traces, mimir-*).

## 4. Bounce the Mimir components

```
kubectl -n observability rollout restart statefulset observability-mimir-ingester
kubectl -n observability rollout restart statefulset observability-mimir-store-gateway
kubectl -n observability rollout restart statefulset observability-mimir-compactor
kubectl -n observability rollout restart statefulset observability-mimir-alertmanager
kubectl -n observability rollout restart deployment observability-mimir-distributor
```

Tail the pods until they settle on `1/1 Running` with no “Access Key Id … does not exist” errors.

## 5. Sync with Argo CD

```
argocd app sync minio
argocd app sync observability
```

That completes the rotation. Update any downstream systems (dashboards, CI jobs) with the new MinIO credentials surfaced by the generator script.

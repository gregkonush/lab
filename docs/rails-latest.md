# rails-latest Service

The `rails-latest` API is a Rails 8.0.3 deployment that runs behind Traefik and relies on CloudNativePG for PostgreSQL and the Redis Operator for caching, sessions, and background jobs.

## Architecture

- **Image:** `registry.ide-newton.ts.net/lab/rails-latest`
- **Namespace:** `rails-latest`
- **Database:** CloudNativePG cluster `rails-latest-db` (primary service `rails-latest-db-rw`)
- **Redis:** Redis Operator instance `rails-latest-redis` (leader service `rails-latest-redis-leader`)
- **Ingress:** Traefik `IngressRoute` at `rails-latest.lab.ts.net`

## Configuration

Environment variables are injected via `rails-latest-secrets` (SealedSecret):

- `RAILS_MASTER_KEY`
- `SECRET_KEY_BASE`

Additional runtime configuration:

- `DATABASE_URL` sourced from the CNPG generated secret `rails-latest-db-app` (`key: uri`)
- `REDIS_URL` resolves to `redis://rails-latest-redis-leader:6379/1`
- `PGSSLROOTCERT` points to `/etc/postgres-ca/tls.crt` from the `rails-latest-db-ca` secret.

## Deployment

```bash
# render manifests
kubectl kustomize argocd/applications/rails-latest/overlays/cluster

# sync via Argo CD CLI
argocd app sync rails-latest
```

## Health Checks

- HTTP: `GET https://rails-latest.lab.ts.net/health` returns `{ "status": "ok" }`
- Kubernetes: Deployment probes mirror the `/health` endpoint (readiness + liveness)

## Runbooks

- **Rollout:** Bump the image tag via CI (Skaffold profiles `rails-latest` / `rails-latest-remote`) or Argo CD Image Updater. Confirm HPA status with `kubectl get hpa -n rails-latest`.
- **Database Maintenance:** Use `kubectl cnpg psql rails-latest-db -n rails-latest` for direct access. Certificates are mounted from `rails-latest-db-ca`.
- **Secret Rotation:** Generate fresh keys, run `scripts/seal-generic-secret.sh rails-latest rails-latest-secrets argocd/applications/rails-latest/overlays/cluster/sealed-secret.yaml RAILS_MASTER_KEY=<value> SECRET_KEY_BASE=<value>`, and resync.
- **Cache Reset:** Flush redis via `kubectl exec -n rails-latest $(kubectl get pod -l app=rails-latest-redis -o name) -- redis-cli FLUSHALL`.

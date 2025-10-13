# dernier service

The `dernier` API is a production Rails 8.0.3 deployment that runs on Knative Serving. It relies on CloudNativePG for PostgreSQL and the Redis Operator for caching, sessions, and background jobs. Argo CD manages the full stack and Knative handles autoscaling between three and five concurrent revisions.

## Architecture

- **Image:** `registry.ide-newton.ts.net/lab/dernier`
- **Namespace:** `dernier`
- **Database:** CloudNativePG cluster `dernier-db` (primary service `dernier-db-rw`)
- **Redis:** Redis Operator instance `dernier-redis` (leader service `dernier-redis-leader`)
- **Ingress:** Knative Serving (Istio ingress gateway) exposes the public route `https://dernier.proompteng.ai`

## System Diagram

```mermaid
graph TD
  User((User / Client))
  KnativeIngress[Knative Ingress Gateway]
  DernierSvc[Knative Service<br/>dernier]
  Postgres[(CloudNativePG<br/>dernier-db)]
  Redis[(Redis Operator<br/>dernier-redis)]
  Secrets{{SealedSecret<br/>dernier-secrets}}
  CA[(Secret<br/>dernier-db-ca)]
  ArgoCD[Argo CD Application]

  User --> KnativeIngress
  KnativeIngress --> DernierSvc
  DernierSvc --> Postgres
  DernierSvc --> Redis
  Secrets --> DernierSvc
  CA --> DernierSvc
  ArgoCD --> DernierSvc
```

## Configuration

Environment variables are injected via `dernier-secrets` (SealedSecret):

- `RAILS_MASTER_KEY`
- `SECRET_KEY_BASE`

Additional runtime configuration:

- `DATABASE_URL` sourced from the CNPG generated secret `dernier-db-app` (`key: uri`)
- `REDIS_URL` resolves to `redis://dernier-redis-leader:6379/1`
- `PGSSLROOTCERT` points to `/etc/postgres-ca/ca.crt` from the `dernier-db-ca` secret.

### Frontend Tooling

- Tailwind CSS v4 powers the UI layer. Source tokens live in `app/assets/tailwind/application.css` and compile to `app/assets/builds/tailwind.css`.
- Run `bin/dev` (Procfile-backed) to boot Rails alongside the Tailwind watcher. Production builds run through `rails tailwindcss:build`.
- Propshaft is enabled so `config.assets` is available even though controllers remain API-first.

### Local development

To boot the application locally:

```bash
cd services/dernier
bundle install
bin/dev
```

`bin/dev` runs both `rails server` (bound to `http://localhost:3000`) and `rails tailwindcss:watch`. Provide `DATABASE_URL` and `REDIS_URL` that point at your local PostgreSQL/Redis instances, or spin them up via Docker:

```bash
docker compose up postgres redis
# in another shell
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dernier_development \
REDIS_URL=redis://localhost:6379/1 \
bin/dev
```

The service prepares the database on startup (see `bin/entrypoint`) and exposes a `/health` endpoint you can cURL while iterating.

### Scaling & Availability

- Horizontal pod autoscaler tracks CPU utilization between 2–5 replicas (`argocd/applications/dernier/overlays/cluster/hpa.yaml`).
- CNPG cluster runs a single primary instance with automated failover once replicas are added.
- Redis operator deploys exporter-sidecar metrics (`:9121`) for Prometheus scraping.

### Secret Management

Use `scripts/seal-generic-secret.sh` to rotate:

```bash
scripts/seal-generic-secret.sh \
  dernier dernier-secrets \
  argocd/applications/dernier/overlays/cluster/sealed-secret.yaml \
  RAILS_MASTER_KEY=<value> \
  SECRET_KEY_BASE=<value>
```

Commit the regenerated SealedSecret and trigger an Argo CD sync.

## Deployment

```bash
# render manifests
kubectl kustomize argocd/applications/dernier/overlays/cluster

# sync via Argo CD CLI
argocd app sync dernier
```

## Health Checks

- HTTP: `GET https://dernier.proompteng.ai/health` returns `{ "status": "ok" }`
- Kubernetes: Deployment probes mirror the `/health` endpoint (readiness + liveness)

## Runbooks

- **Rollout:** Bump the image tag via CI (Skaffold profiles `dernier` / `dernier-remote`) or Argo CD Image Updater. Confirm HPA status with `kubectl get hpa -n dernier`.
- **Database Maintenance:** Use `kubectl cnpg psql dernier-db -n dernier` for direct access. Certificates are mounted from `dernier-db-ca`.
- **Secret Rotation:** Generate fresh keys, run `scripts/seal-generic-secret.sh dernier dernier-secrets argocd/applications/dernier/overlays/cluster/sealed-secret.yaml RAILS_MASTER_KEY=<value> SECRET_KEY_BASE=<value>`, and resync.
- **Cache Reset:** Flush redis via `kubectl exec -n dernier $(kubectl get pod -l app=dernier-redis -o name) -- redis-cli FLUSHALL`.

## Observability

- Rails logs stream to stdout and are collected by the platform’s fluent agent.
- CNPG and Redis exporters expose metrics consumed by the observability stack via the shared Prometheus pipeline.
- Enable verbose logging temporarily with `RAILS_LOG_LEVEL=debug` through a sealed secret rotation; remember to revert to `info`.

# Convex Backend (ArgoCD)

## Components
- `backend-*` resources deploy `ghcr.io/get-convex/convex-backend`, pull site/cloud origins from the ConfigMap, and surface ports 3210/3211 internally while Traefik publishes `https://convex.proompteng.ai`.
- `postgres-cluster.yaml` provisions a single-instance CloudNativePG cluster (`convex-db`) with a 30Gi volume and creates the application secret (`convex-db-app`) consumed by the backend via `DATABASE_URL`.
- `dashboard-*` resources run `ghcr.io/get-convex/convex-dashboard` for administration. The dashboard stays private on the tailnet.

## Required Secrets
Generate the sealed secret before syncing:

```bash
kubectl create secret generic convex-backend-secrets \
  -n convex \
  --from-literal=CONVEX_INSTANCE_NAME=<instance-name> \
  --from-literal=CONVEX_INSTANCE_SECRET=<instance-secret> \
  --from-literal=CONVEX_ADMIN_KEY=<admin-key> \
  --dry-run=client -o yaml \
| kubeseal \
  --controller-name=sealed-secrets \
  --controller-namespace=sealed-secrets \
  --format=yaml \
> argocd/applications/convex/backend-sealedsecret.yaml
```

Commit the regenerated manifest so ArgoCD can decrypt it inside the cluster.

## Configuration
`backend-configmap.yaml` defaults to `https://convex.proompteng.ai` so Convex clients use your public Traefik ingress for both HTTP (`/http`) and WebSocket traffic. Keep the `/http` suffix on `CONVEX_SITE_ORIGIN`, and point `CONVEX_CLOUD_ORIGIN` at the bare host. If you change the hostname, update those values plus the ingress route. Set `NEXT_PUBLIC_DEPLOYMENT_URL` to the same host so the dashboard links resolve correctly.

`postgres-cluster.yaml` bootstraps the `convex_self_hosted` database and owner. The backend reads the generated connection string from the `convex-db-app` secret (`key: uri`). Rotate credentials by running `kubectl cnpg reload convex/convex-db --primary --in-place`, then resync ArgoCD so the Deployment picks up the new secret revision.

## Sync Notes
The `convex` namespace is created automatically (`CreateNamespace=true`). Traefik exposes the backend via `IngressRoute` at `convex.proompteng.ai`; confirm certificates and DNS in the Traefik stack before syncing.

## Tailscale Exposure
Only the dashboard Service uses the Tailscale load balancer annotations. Ensure the Tailscale Kubernetes operator is installed and allowed in `convex` so the private hostname `convex` becomes reachable to tailnet members.

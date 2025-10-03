# @proompteng/bonjour

TypeScript sample service that renders Kubernetes resources with cdk8s via the official CLI. The runtime image only contains the Hono server; Argo CD's config management plugin (CMP) installs dependencies, runs the CLI, and applies the manifests at reconciliation time.

## Scripts

- `pnpm --filter @proompteng/bonjour dev` – run the Hono server locally on port 3000.
- `pnpm --filter @proompteng/bonjour synth` – regenerate manifests in `packages/bonjour/manifests/` using `cdk8s synth --no-check-upgrade --app "tsx --tsconfig infra/tsconfig.json infra/main.ts"` (append `-- -- --stdout` to stream YAML to the console).
- `pnpm --filter @proompteng/bonjour build` – compile TypeScript to `dist/` for packaging.
- `pnpm --filter @proompteng/bonjour clean` – remove build and manifest artifacts.
- `scripts/build-bonjour.sh [tag]` – build and push the Docker image to `registry.ide-newton.ts.net/lab/bonjour` (defaults to the current git SHA if no tag is provided).

## Generated Assets

Running `pnpm --filter @proompteng/bonjour synth` (which wraps `cdk8s synth --no-check-upgrade --app "tsx --tsconfig infra/tsconfig.json infra/main.ts"`) produces outputs intended for local inspection only:

```
packages/bonjour/manifests/
  bonjour.k8s.yaml           # Deployment, Service, HPA
```

Configure synthesis via environment variables:

- `IMAGE` – container image reference (default `registry.ide-newton.ts.net/lab/bonjour:latest`).
- `REPLICAS` – minimum replica count for the HPA target (default `2`).
- `PORT` – container port (default `3000`).
- `NAMESPACE` – Kubernetes namespace metadata (default `default`).
- `CPU_TARGET_PERCENT` – average CPU utilization target for the HPA (default `70`).

## Argo CD Integration

The repo-server sidecar in `argocd/applications/argocd/overlays/argocd-cdk8s-plugin.yaml` runs the stock `node:lts-slim` image, mounts `plugin/cdk8s-plugin.yaml` via a ConfigMap, and now installs `cdk8s-cli@latest` globally during the CMP `init` phase. Argo CD runs `cdk8s synth --app "pnpm exec tsx --tsconfig infra/tsconfig.json infra/main.ts"` during `generate`, streaming the resulting YAML to the repo-server for reconciliation. Point an `Application` (or the `ApplicationSet` entry in `argocd/applicationsets/cdk8s.yaml`) at `packages/bonjour` and set `source.plugin.name: cdk8s` to activate the plugin.

## Continuous Delivery

Pushes to `main` that touch `packages/bonjour/**` trigger the shared `Docker Build and Push` workflow, which now includes a `build-bonjour` job. The job tags and pushes `registry.ide-newton.ts.net/lab/bonjour` images using the repo-wide `docker-build-common` composite with the same semver tagging automation as other services.

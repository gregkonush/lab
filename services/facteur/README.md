# facteur

`facteur` is a Go service that will mediate Discord bot commands into Argo workflow executions. This directory currently contains the CLI scaffolding, configuration layer, and deployment manifests that future work will extend with real integrations. See `docs/facteur-discord-argo.md` for the end-to-end architecture and configuration contract.

## Layout

- `cmd/facteur`: Cobra-based CLI entrypoints.
- `internal`: Internal packages that will house configuration, Discord routing, Argo bridge logic, and session storage.
- `config`: Example configuration files and schema references (role map schema lives at `schemas/facteur-discord-role-map.schema.json`).
- `Dockerfile`: Multi-stage build for containerizing the service.

Refer to the repository docs for detailed integration guidance and follow-up tasks.

## Running locally

```bash
cd services/facteur
go run . serve --config config/example.yaml
```

The `--config` flag is optional if you provide the required `FACTEUR_*` environment variables. Press `Ctrl+C` to stop the server; it will shut down gracefully.

## Container image

The service ships as `registry.ide-newton.ts.net/lab/facteur`. Pushes to `main` that touch `services/facteur/**` or `.github/workflows/facteur-build-push.yaml` trigger the `Facteur Docker Build and Push` workflow, which cross-builds (linux/amd64 + linux/arm64) using the local Dockerfile and pushes tags for `main`, `latest`, and the commit SHA. Rotate the image in Kubernetes by updating tags in `kubernetes/facteur/overlays/cluster/kustomization.yaml` or allow Argo tooling to reference the desired tag.

## Deploying with `kn`

When you need to reconcile the Knative Service directly, you can apply the manifest with the Knative CLI:

```bash
# From the repository root
kn service apply -f kubernetes/facteur/base/service.yaml
```

The command mirrors the manifest-driven deployment used by the rest of the repo, so it is safe to run between Argo CD syncs when you want to force a rollout.

## Infrastructure dependencies

`kubernetes/facteur/base/redis.yaml` requests a standalone `Redis` instance managed by the OT-Container-Kit Redis Operator. The Knative Service targets the generated ClusterIP service (`redis://facteur-redis:6379/0`). Ensure the platform `redis-operator` Application remains healthy before syncing facteur; it must be available to reconcile the custom resource.

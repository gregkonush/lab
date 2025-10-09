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

### Kafka consumer loop

The Discord command pipeline can be exercised locally once a Kafka broker is available:

```bash
cd services/facteur
go run . consume --config config/example.yaml
```

The consumer is gated behind `consumer.enabled` in the configuration and defaults to `localhost:9092` for development. A DLQ can be enabled by setting `consumer.dlq.enabled` and `consumer.dlq.topic`. The helper script `scripts/facteur-consumer-local.sh` wraps the command with sensible defaults for local smoke tests.

To submit workflows the process needs Kubernetes API credentials. When running outside the cluster, set `FACTEUR_KUBECONFIG` (or rely on `KUBECONFIG`) to the path of a kubeconfig file that has access to the target namespace.

## Container image

The service ships as `registry.ide-newton.ts.net/lab/facteur`. Pushes to `main` that touch `services/facteur/**` or `.github/workflows/facteur-build-push.yaml` trigger the `Facteur Docker Build and Push` workflow, which cross-builds (linux/amd64 + linux/arm64) using the local Dockerfile and pushes tags for `main`, `latest`, and the commit SHA. Rotate the image in Kubernetes by updating tags in `kubernetes/facteur/overlays/cluster/kustomization.yaml` or allow Argo tooling to reference the desired tag.

## Infrastructure dependencies

`kubernetes/facteur/base/redis.yaml` requests a standalone `Redis` instance managed by the OT-Container-Kit Redis Operator. The Knative Service targets the generated ClusterIP service (`redis://facteur-redis:6379/0`). Ensure the platform `redis-operator` Application remains healthy before syncing facteur; it must be available to reconcile the custom resource.

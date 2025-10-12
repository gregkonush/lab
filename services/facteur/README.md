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

## Observability

Facteur boots with OpenTelemetry telemetry enabled. Traces and metrics are exported via OTLP/HTTP, targeting the in-cluster LGTM deployment by default. The Knative manifest supplies the following environment variables:

- `OTEL_SERVICE_NAME=facteur`
- `OTEL_SERVICE_NAMESPACE` (populated from the pod namespace)
- `OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf`
- `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=http://lgtm-tempo-gateway.lgtm.svc.cluster.local:4318/v1/traces`
- `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT=http://lgtm-mimir-nginx.lgtm.svc.cluster.local/otlp/v1/metrics`
- `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT=http://lgtm-loki-gateway.lgtm.svc.cluster.local/loki/api/v1/push`

When running locally, point these values at your LGTM environment to keep telemetry flowing. The service emits counters such as `facteur_command_events_processed_total`, `facteur_command_events_failed_total`, and `facteur_command_events_dlq_total`, and wraps the Fiber HTTP server with OTEL middleware so HTTP requests appear in traces.

Cluster deployments rely on a namespace-scoped Grafana Alloy deployment (`argocd/applications/facteur/overlays/cluster/alloy-*.yaml`) to forward Knative pod logs to the LGTM Loki gateway, since the Knative stack does not configure log shipping on its own.

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

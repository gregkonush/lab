# LGTM Observability Stack

This Argo CD application deploys the Grafana LGTM (Loki, Grafana, Tempo, Mimir) stack
with the upstream `lgtm-distributed` Helm chart. The provided `lgtm-values.yaml`
tunes the chart for the lab cluster by:

- enabling persistent volumes with the `longhorn` storage class for all
  stateful components (Grafana dashboards, Loki ingesters, Mimir stores, Tempo
  trace blocks, and the backing MinIO bucket),
- exposing the Grafana dashboard through a Tailscale load balancer for
  secure remote access,
- reducing replica counts to a single instance where safe to conserve
  resources, and
- pre-provisioning Grafana datasources that point at the in-cluster Loki,
  Tempo, and Mimir services so dashboards work out of the box.

The application is discovered by the `platform` ApplicationSet and is
synchronized into the `lgtm` namespace.


## Alloy River Notes

All in-cluster observability shippers (e.g., `argocd/alloy-*.yaml`, `argo-workflows/alloy-*.yaml`) share the same Grafana Alloy conventions. Keep River syntax consistent to avoid startup errors:

- Scope Kubernetes discovery with the nested block syntax: `namespaces { names = ["<namespace>"] }`. Inline attributes like `namespaces = [...]` are rejected by Alloy v1.11+ and cause the controller to crash before shipping telemetry. citeturn0search0
- Chain discovery relabelers into Prometheus scrapes via the `output` receiver. Example: `targets = discovery.relabel.argocd_metrics.targets`. This matches the exported label set from the relabel component. citeturn1search0turn4search1
- `loki.source.kubernetes` inherits namespace selection from the discovery targets—it does **not** expose its own `namespaces` field. If you need to scope logs, do it on the discovery component feeding the source. citeturn2search5
- Keep OTLP writers pointed at the shared LGTM gateways (`lgtm-mimir-nginx`, `lgtm-tempo-gateway`, `lgtm-loki-gateway`) so every Alloy instance stays aligned with the central stack.

When adding another Alloy deployment, copy one of the existing configs and validate with `kubectl kustomize` (or `alloy check`) before syncing Argo CD.

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

- Scope Kubernetes discovery with the nested block syntax: `namespaces { names = ["<namespace>"] }`. Inline attributes like `namespaces = [...]` are rejected by Alloy v1.11+ and cause the controller to crash before shipping telemetry (see the Grafana Alloy `discovery.kubernetes` reference). 
- Chain discovery relabelers into Prometheus scrapes via the `output` receiver. Example: `targets = discovery.relabel.argocd_metrics.output`. This matches the exported target list from the relabel component (documented in Grafana Alloy `discovery.relabel`). 
- `loki.source.kubernetes` inherits namespace selection from the discovery targets—it does **not** expose its own `namespaces` field. If you need to scope logs, do it on the discovery component feeding the source (per the Grafana Alloy `loki.source.kubernetes` reference). 
- Stick to the attributes called out in the component reference docs. In particular, `loki.source.kubernetes` does **not** support `allow_out_of_order` or `drop_deleted_pods` in Alloy v1.11+, so leaving them in a River file will prevent the process from starting. 
- Keep OTLP writers pointed at the shared LGTM gateways (`lgtm-mimir-nginx`, `lgtm-tempo-gateway`, `lgtm-loki-gateway`) so every Alloy instance stays aligned with the central stack.

When adding another Alloy deployment, copy one of the existing configs and validate with `kubectl kustomize` (or `alloy check`) before syncing Argo CD.

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

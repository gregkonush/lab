# Bayn cache and database observability

Use [Bayn Cache and Database Performance](https://grafana.ide-newton.ts.net/d/bayn-cache-performance)
to inspect the running source revision. The existing
[trading dashboard](https://grafana.ide-newton.ts.net/d/bayn-cycle-operations) retains readiness, authority,
reconciliation freshness and economic evidence. Neither dashboard grants trading authority.

## Collection

The central Alloy discovers only `buf.red/name=bayn-valkey` pods in namespace `bayn`, scrapes each `exporter`
port every fifteen seconds and retains a bounded Redis metric allowlist. Valkey exposes `redis_*` metric names.
The same discovery collects only the `valkey` and `exporter` containers into Loki. Existing network and log-read
permissions cover this collector; it never reads cache credentials.

The API appends native Effect metrics to its existing `/metrics` endpoint, collected by Alloy. Each execution
worker owns one native Effect OTLP metrics exporter at the process entry point because its Restate HTTP/2 endpoint
has no Prometheus route. Nested managed runtimes inherit metric identity and share the process registry without
starting exporters. The worker destination is the existing Mimir gateway `/otlp/v1/metrics`, with a fifteen-second cumulative
export interval. Worker egress permits only that gateway's pods on TCP 8080 in `observability`.

`bayn_operation_duration_seconds` records inclusive wall time for successful, failed and interrupted operations.
Fixed stage, operation, dependency, outcome, service, namespace and source-revision labels describe the work.
The OTLP resource identifies the pod. Cache keys, content hashes, account/order/cycle identifiers and raw errors
are excluded from metric labels.

- `bayn.valkey.put` includes queueing, SET and the complete required replica acknowledgement. Its child
  `bayn.valkey.set` and `bayn.valkey.replica-ack` spans/histograms separate those components. The original single
  one-second command deadline, cancellation and one-replica requirement remain in force.
- `bayn_valkey_reads_total` counts successful GET results as `hit` or `miss`. A required materialization miss still
  fails closed. Transport failures are counted separately in `bayn_valkey_failures_total` by bounded category.
- `bayn_valkey_unacknowledged_waits_total` counts WAIT replies below one acknowledgement, including eventual
  successful retries. It is not a count of failed publications.
- Materialization latency includes GET, JSON decoding, schema checks and content hashing; payload-byte histograms
  distinguish full snapshots from compact state. Writer fencing, commit, broker publication and reconciliation
  retain separate measurements. Parent and child timings overlap and must not be summed.
- `bayn.postgres.generation-settlement` measures the actual named SQL statement outside the surrounding commit.
  CNPG's read-only catalog query exports validity, readiness and cumulative activity for the exact generation
  expression index. Zero scans can be correct when no eligible restricted generation exists. An index scan counter
  does not prove one statement used that index; investigate regressions with its trace and a bounded read-only plan.

Missing series and no-traffic quantiles remain unknown. The dashboard does not replace absent evidence with zeros.

## Alerts and diagnosis

The `bayn-cache-performance.rules` Mimir group contains eight rules. They use the existing trading email route.

| Alert                             | Trigger and next evidence                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BaynValkeyMetricsUnavailable`    | Fewer than two healthy exporter/server pairs for two minutes. Check discovery, scrape errors and both pods.                                                                                |
| `BaynValkeyReplicaUnavailable`    | No connected replica or replica link down for one minute. Publication requires WAIT; recover the peer.                                                                                     |
| `BaynValkeyMemoryPressure`        | More than 85% of configured cache memory for ten minutes. Inspect payload bytes and expiry; `noeviction` can reject writes.                                                                |
| `BaynValkeyPublicationFailure`    | A failed replicated put in the last five minutes, held for one minute. Join failure category with the publication trace.                                                                   |
| `BaynValkeyLatencyHigh`           | Successful GET/PUT p99 above 250ms for five minutes, with at least twenty samples. Compare SET, WAIT and queueing. This diagnostic threshold is one quarter of the command deadline.       |
| `BaynOperationMetricsUnavailable` | A missing or more than ninety-second-old service heartbeat for two minutes while the API revision expects native metrics. Check OTLP export failure logs and the exact Mimir network path. |
| `BaynGenerationIndexUnavailable`  | Missing, invalid or unready index observation for two minutes. Inspect migration 104 and CNPG query collection.                                                                            |
| `BaynGenerationSettlementSlow`    | Statement p95 above 500ms for ten minutes, with at least twenty samples. Inspect waits, the statement trace and a bounded read-only plan.                                                  |

The API pull metric `bayn_operation_metrics_expected` gates native export absence alerts during the initial rollout.
This source-bound indicator remains available when the separate OTLP metrics path fails. Heartbeats must match
each API-advertised source revision; retained older workers cannot satisfy it. Within a revision, the newest exporter
per service is observed; existing replica alerts cover missing workers/APIs. No notification test is sent by acceptance.

## Verify a rollout

Verify the reviewed source, immutable image, Kargo Freight/promotion and generated `kargo/bayn` revision using
[release automation](../release-automation.md). Check API readiness and the actual runtime status separately.
Forward the three existing observability services with explicit context and namespace:

```sh
kubectl --context galactic-tailscale -n observability port-forward svc/observability-mimir-gateway 19116:80
kubectl --context galactic-tailscale -n observability port-forward svc/observability-loki-v3-gateway 19115:80
kubectl --context galactic-tailscale -n observability port-forward svc/observability-tempo-v3-query-frontend 19114:3200
```

From another terminal run the read-only verifier, using the full deployed source SHA:

```sh
python3 services/bayn/tools/verify-cache-observability.py --source <40-character-source-sha>
```

It checks both exporter/server pairs, required replication, four fresh source-bound native heartbeats, operation
histograms, cache hits, payload sizes, index validity/activity, evaluated rules, collected server logs and native WAIT
traces. A quiet server can have old log timestamps; the verifier searches forty-eight hours. Inspect Grafana's loaded
dashboard and its panel queries after acceptance. Notification delivery and a long-term latency SLO are separate evidence.

Validate the twelve missing-data/threshold behavior cases with the existing native PromQL test harness.
Use `promtool` 3.5.0 on `PATH`, or set `PROMTOOL` to its executable; CI already provisions the pinned checker.

```sh
bun test packages/scripts/src/shared/__tests__/bayn-cache-promql.test.ts
```

Recover an application regression through the prior eligible Kargo image. Revert unwanted collector, catalog,
dashboard or rule changes in Git and reconcile that reviewed state. Keep required cache replication and trading fences.

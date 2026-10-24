# Bayn system cleanup, October 20, 2026

> **Archived record.** This is a point-in-time audit, not current guidance. The migrations it inspects have been
> applied, and it is not a retention policy or a continuing health guarantee. Current guidance is in the
> [service README](../../../services/bayn/README.md) and [architecture](../../../docs/bayn/architecture.md).

## Scope and evidence

This audit compares source `99b89a30f308dcdc90771711e1995ec85b206b54` with the running service,
the `bayn-db-1` primary, and the existing cache-observability verifier. Production inspection was read-only.
The deployed source matched the checkout. Its embedded image digest was
`sha256:c2b6d025bf27ce08304d43ffd2904151f39942e962c029ea93c7a3af2ced4371`.
Measurements were collected on October 20 Pacific time, October 21 UTC. They describe that observation,
not a retention policy or a continuing health guarantee.

The source audit followed executable service and research entries, broker ingestion, SQL functions and triggers,
migrations, historical readers, tests, tools, and deployment consumers. The relative-import inventory left only
dedicated test helpers, fixtures and the documented manual projection benchmark outside the command roots.
A table without a TypeScript reference can still serve an active SQL trigger.

## Removed contracts

Migration 134 removes six tables after locking them and verifying that each is empty:

- `broker_errors` and `rate_limits`.
- `opening_drive_qualification_locks`, `opening_drive_qualification_replay_versions`,
  `opening_drive_qualification_results`, and `opening_drive_qualification_session_replays`.

Exact production counts were zero for all six. Current broker inputs and adapters produce account, position,
order and fill events. Only contract tests constructed the decoded `Error` and `RateLimit` variants.
A query-performance fixture also used a SQL `ERROR` row; it now uses an `ORDER` row and retains its non-account
filter and scan-budget assertion. Provider failures retain their typed operational paths, including rate limits
and unknown mutation outcomes.

The migration narrows `broker_events.event_kind` to the four active kinds and updates
`enforce_broker_event_payload()` before removing its obsolete branches. The deferred exactly-one-payload
guard remains enforced. A populated retired table or event aborts the transaction. No `CASCADE`, row deletion,
compatibility alias, or replacement archive is involved. Earlier migrations remain available to reconstruct
the schema and verify historical upgrades.

The public entrypoint composes its application directly; its forwarding module is removed.
The package no longer directly declares `@clickhouse/client` or `@sentry/server-runtime-injection`.
Their owning integrations retain their dependency declarations. `@opentelemetry/core` remains because
Restate's OpenTelemetry integration declares it as a peer dependency.

## Retained database evidence

The database occupied about 14 GiB. These total relation sizes include indexes and TOAST storage:

| Relation                            | Observed total bytes | Reason to retain                                             |
| ----------------------------------- | -------------------: | ------------------------------------------------------------ |
| `native_arrival_chunks`             |       10,926,792,704 | Original Kafka deliveries, arrival order and replay receipts |
| `intraday_candidate_observations`   |        1,266,483,200 | Immutable inputs bound to inference and decisions            |
| `autonomous_cycle_shadow_decisions` |        1,085,882,368 | Historical decisions and their evidence                      |
| `broker_events`                     |          652,083,200 | Broker/accounting source identities and reconciliation       |
| `execution_unit_cutover_archive`    |          190,898,176 | Original financial records retained by migration 97          |

`pg_stat_user_tables.n_live_tup` reported zero for several populated historical tables. Exact counts found
5,829 lifecycle commands, 13,115 archive-availability records, 234 research-capture chunks, 13 research seals,
102 evaluation artifacts, 3,488 evaluation events, 42 gate outcomes and 12 status-history records.
These records are not disposable merely because their statistics or current application reference count is zero.
`qualification_trials` still serves the evaluation-completion trigger. Replay tests still use
`simulated_broker_checkpoints`.

All observed indexes were valid and ready. Thirteen historical write constraints were installed without
validating older rows. They include retired position, intent, authority and cycle contracts.
An unvalidated historical constraint does not mean current writes bypass the constraint.

Native capture had 74 epochs, 49 stopped ends, three incomplete ends and 22 epochs without an end record.
An absent end does not prove that the retained prefix is disposable. A capture-retention change needs coverage
and reference rules before removing bytes. This cleanup installs no age-based purge.

## Observability and runtime

The existing read-only verifier observed two Valkey/exporter pairs, four fresh source-bound heartbeats,
731 histogram series and five source-bound replica-acknowledgement traces. The generation lookup index
was present, valid and ready. All eight cache alert rules were healthy and inactive.

The Valkey log query returned no streams over 48 hours, so log collection remains unproven.
Notification delivery and profitability were not tested. No metric or alert was removed solely because
it was quiet or lacked a dashboard panel.

The integration baseline later advanced to `8bed05c8f6ca87e428522e76716e75e85cb40f5c`, which owns migration 132.
Cleanup was rebased and numbered 134. Read-only verification of that deployed revision observed four fresh
heartbeats, 656 histogram series, five replica-acknowledgement traces and the same eight healthy inactive alerts.
Both checked Loki endpoints returned no matching Valkey log streams.

Before delivery, `main` advanced to `4cede0109a7ac22d0b849b75c82fe3c7d9291b45` and already owned
`133_complete_plan_choice`. The cleanup uses `134_remove_unused_schema` to preserve that deployed migration.

The status projection reported PAPER authority, an active controller, exact reconciliation, zero positions,
zero unfinished cycles and zero unresolved mutations. These are operational observations, not economic
qualification or permission to change account limits.

## Reproduce the database audit

Run the bounded read-only audit against the currently verified primary:

```sh
kubectl -n bayn get cluster bayn-db -o jsonpath='{.status.currentPrimary}{"\n"}'
kubectl -n bayn exec -i <verified-primary> -c postgres -- \
  psql -X -U postgres -d bayn -P pager=off < services/bayn/tools/audit-database.sql
```

The audit labels catalog row counts as estimates and separately counts retained and retired candidates.
It handles the removed tables both before and after migration 134. Statements have deadlines, and failures
stop execution. Output contains sizes, counts and schema names, without account identifiers or payloads.

Run `tools/verify-cache-observability.py` with the deployed full source revision and verified Mimir,
Loki and Tempo endpoints for the separate observability acceptance check.

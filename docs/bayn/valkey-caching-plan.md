# Bayn caching plan

Valkey is a disposable acceleration layer. PostgreSQL remains the trading source
of truth, TigerBeetle remains the accounting source, and Restate remains the
scheduler and owner of durable inference claims. This change supplies a client
and a smaller cache deployment; it does not claim a measured trading or latency
improvement and does not add cache reads to execution decisions.

## Evidence and first measurement

The current [broker projection](../../services/bayn/src/db/broker-observations.ts)
already shares observations through PostgreSQL. Its reads check source revision,
mutation events, newer broker events, reservations and freshness. Copying that
payload into Valkey without those checks would weaken correctness.

The [forward-performance reader](../../services/bayn/src/forward-performance/postgres/read.ts)
reads completed cycles, strategy rows, reconciliation and capital evidence in a
consistent PostgreSQL transaction. The [HTTP status renderer](../../services/bayn/src/http.ts)
combines economics with current authority, execution and health. Cache an
isolated presentation result, never the complete status document.

A live Mimir query on 2026-10-13 at 22:52 UTC found a maximum sampled primary
client-backend active-query age of 16.499785 seconds over the preceding hour:

```promql
max(max_over_time(cnpg_bayn_waits_active_query_age_seconds{
  namespace="bayn", role="primary", backend_type="client backend"
}[1h]))
```

This is sampled query age, not query duration, a latency percentile or proof
that a particular read causes the delay. Transaction-rate and block-hit queries
returned no series under the attempted metric names. Their result is unknown.
Before choosing the first cache site, correlate Tempo spans for that reader and
broker projection with PostgreSQL wait events, call counts and payload sizes.
Measure a normal open-market session and a quiet period separately.

## Candidate order

| Priority | Candidate and owner                                                                                        | Key identity                                                                                                       | Expiry and correctness                                                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1        | Completed-cycle economics for presentation, owned by the forward-performance read model                    | Schema version, source revision, account hash, authority generation, session date and durable completion watermark | Start at 2 seconds. Preserve the report's original as-of time. Read authority, current reconciliation and health separately.                                                                                 |
| 2        | Verified immutable calendar/manifest and closed-window feature payloads, owned by market-data verification | Dataset/publication content hash, calendar/universe version, symbol and closed window                              | Up to 5 minutes. Verify the content hash and schema on every hit; a different publication produces a different key. Never cache unfinished windows or absence as finalized data.                             |
| 3        | Large broker projection payloads, only if traces prove payload transfer/decoding dominates                 | Account hash, source revision and snapshot content hash                                                            | Requires a fresh authoritative PostgreSQL validity/generation check first. Existing event, mutation and freshness checks remain mandatory. This is a separate correctness project, not the first cache site. |

Do not cache writer fences, grants, submit/cancel reservations, unknown mutation
outcomes, exact reconciliation decisions, order authorization, accounting
transfers, quotes beyond their existing deadline, or model inference claims.
Do not cache a failure, unavailable observation or missing evidence as success.

## Delivery units

1. Establish the per-operation baseline. Record calls, returned bytes, p50/p95
   latency, PostgreSQL query time and CPU, plus live source revision and traffic
   window. Confirm that repeated eligible reads are a material share of cost.
2. Implement only the highest-impact safe candidate. Cache-aside reads use the
   existing authoritative reader on a miss or a `ValkeyCacheError`; invalid input
   and schema/content mismatches remain visible failures. Start with a 50 ms
   caller budget and the existing source path. The client's one-second transport
   ceiling is an absolute bound, not a target latency.
3. Test a warm hit, cold miss, expiry, corrupt value, stale watermark, account and
   source isolation, cache outage, cancellation and concurrent misses. Keep
   original observation times. Coalesce concurrent fills inside one process
   using existing Effect facilities if measurement shows a stampede; add no
   distributed locking service.
4. Compare the same request mix before and after. Proposed acceptance targets
   are at least 20% lower p95 and 50% fewer authoritative reads for the selected
   path, with at least 80% hits after warmup and no stale-authority acceptance.
   These are targets, not observed results. Reject the cache site if the source
   path is already faster or cache coordination costs more than it saves.
5. Deliver each accepted site through normal Bayn CI, immutable image
   publication, Kargo promotion and live product readback. Roll back by reverting
   that cache call site; the authoritative source remains sufficient.

Track hit, miss, expiry and transport-failure counts by operation and cache
family, plus lookup/source latency and value size. Keep keys, values, account
identifiers and credentials out of logs and metric labels. Monitor Valkey
memory/rejected writes and PostgreSQL load together. `noeviction` or a failed
primary must reduce the hit rate, not block trading or fabricate data.

## Client contract

[ValkeyCache](../../services/bayn/src/valkey-cache.ts) provides `get`, `put` and
`remove`. Keys must begin with `bayn:`; each write requires a positive integer
expiry up to five minutes and a value of at most 262,144 characters. A miss is
`Option.none`; transport failure is an error. Consumers decode their own domain
schema after a hit. There is no silent fallback inside the client.

The scoped official Effect Node Redis adapter uses TLS with the existing CA and
client certificate, an offline queue disabled, bounded connection/command time,
and finalization that destroys outstanding transport work. Interruption closes
the shared connection; concurrent cache operations can fail, and the next call
can reconnect. Callers must retain their authoritative fallback and may not use
a cache error to weaken a trading guard. Connection acquisition also returns a
`ValkeyCacheError`; handle it at the optional cache boundary rather than making
cache connectivity a requirement for service startup or readiness. The workload's
ConfigMap, password and TLS Secret references are optional so missing cache
artifacts cannot block authoritative service recovery. Missing cache
configuration and TLS material remain typed availability failures.

`node dist/valkey-command.js` verifies miss, write/read, deletion and expiry using
synthetic keys with the same client. Configuration comes from
`bayn-valkey-connection`, the existing password Secret and mounted client TLS
material. Cache-client acceptance is separate from economic qualification.

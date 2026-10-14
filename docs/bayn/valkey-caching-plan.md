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

A retained [diagnostic sample](evidence/2026-10-13-cache-diagnostics.json) after
[PR #14994](https://github.com/proompteng/lab/pull/14994), source
`36e65006b6381d721e05f8eb2f094d3cb90a672d`, ten postclose broker polls had
13 journal entries each and zero lazy state reads. Active times ranged from
5.342 to 28.897 seconds, with a 10.8625-second median. This was a small postclose
sample with no new protective closure orders, not an open-market baseline.
One retained poll trace included a 1.935-second SQL span, 1.706 seconds in
broker capture and 0.523 seconds in publication. These timings do not establish
avoidable payload-read work. Caching cannot replace durable capture claims,
quota reservations or Restate journal/WAL persistence.

## Candidate order

| Priority | Candidate and owner | Key identity | Expiry and correctness |
| -------- | ------------------- | ------------ | ---------------------- |
| 1 | Shared read-only status economics and historical accounting projections, owned by the forward-performance read model | Schema version, source revision, account hash, authority generation, session date and durable completion watermark | Start at 2 seconds. Preserve original as-of time. Read authority, readiness and current reconciliation separately; never cache a fabricated healthy result. |
| 2 | Verified immutable calendar/manifest, retained market windows and decoded research observations, owned by market-data verification | Dataset/publication content hash, protocol and calendar/universe version, symbol and closed window | Up to 5 minutes. Verify content identity and schema on each hit. Preserve observedAt, arrival times, exclusions, watermark and freshness checks. A cache cannot make a historical fetch available to an earlier live decision. |
| 3 | Immutable broker snapshot payloads, if traces show transfer/decoding dominates; start with status/read-only consumers | Account binding hash, source revision and verified snapshotHash | A latest pointer is advisory. Require a fresh authoritative PostgreSQL generation/availability/mutation check first. Existing broker-event, reservation and freshness checks remain mandatory. |
| 4 | Public filing and macro-calendar artifacts, when their asynchronous acquisition owner is available | Source/content identity, fetchedAt and amendment or calendar revision identity | Up to 5 minutes for the cache copy. Acquisition owns source freshness and revision history. Execution and protective closures must never await public HTTP or a cache fill; later amendments cannot enter earlier decisions. |
| 5 | Immutable model metadata and versioned rate cards, only if repeated reads are material | Provider/model contract identity and metadata or rate-card content hash | Up to 5 minutes. Preserve the quote frozen per inference request and durable TigerBeetle posting. Cache neither an expense acknowledgement nor an unverified pricing claim as truth. |

Use the existing canonical hashing helpers to encode complete composite identity
as `bayn:<schema>:<family>:<identityHash>`. Retain domain schema, identity and
original observation times in the value and verify them on every hit. Keep
values beyond the client's size limit on the authoritative path; measure their
size instead of adding chunking or silently raising the limit.

Do not cache writer fences, grants, kill state, capture claims, quota or
submit/cancel reservations, unknown mutation outcomes, live balances, exact
reconciliation decisions, order authorization, accounting transfers or ledger
acknowledgements, quotes beyond their existing deadline, or model inference claims.
Do not cache a failure, unavailable observation or missing evidence as success.

## Delivery units

1. Establish the per-operation baseline. Record calls, returned bytes, p50/p95/p99
   latency, PostgreSQL query time and CPU, plus live source revision and traffic
   window. Confirm that repeated eligible reads are a material share of cost.
2. Implement only the highest-impact safe candidate. Cache-aside reads use the
   existing authoritative reader on a miss or a `ValkeyCacheError`; invalid input
   and schema/content mismatches remain visible failures. Start with a 50 ms
   caller budget within the existing total deadline; fallback uses the remaining
   budget and the existing source path. The client's one-second transport
   ceiling is an absolute bound, not a target latency.
3. Test a warm hit, cold miss, expiry, corrupt value, stale watermark, account and
   source isolation, eviction, primary loss/manual recovery, unavailable Valkey,
   cancellation and concurrent misses. Keep original observation times. Coalesce concurrent fills inside one process
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
family, plus timeout counts, payload age, lookup/source p50/p95/p99, bytes and
underlying SQL/broker request reductions. Keep keys, values, account identifiers
and credentials out of logs and metric labels. Monitor Valkey
memory/rejected writes and PostgreSQL load together. `noeviction` or a failed
primary must reduce the hit rate, not block trading or fabricate data.

## Client contract

[ValkeyCache](../../services/bayn/src/valkey-cache.ts) provides `get`, `put` and
`remove`. Keys must begin with `bayn:`; each write requires a positive integer
expiry up to five minutes and a value of at most 262,144 characters. A miss is
`Option.none`; transport failure is an error. Consumers decode their own domain
schema after a hit. There is no silent fallback inside the client.

The scoped Effect client loads configuration and TLS material and opens its
Node Redis SDK connection only on the first valid operation. Layer acquisition
requires no cache artifacts or network access. One semaphore serializes first
connection and reconnection; ordinary commands share the connected client.
TLS uses the existing CA and client certificate. Offline queues are disabled,
and the total operation deadline covers configuration, TLS loading, connection
handshake and command work. Interruption destroys outstanding transport work,
including a stalled handshake. The official Effect Node Redis layer connects
eagerly and waits for in-flight work during graceful shutdown, so it is not used
for this optional, cancellable capability.

Interruption closes the shared connection; concurrent cache operations can
fail, and the next call can reconnect. Configuration, connection and transport
failures are `ValkeyCacheError` values returned by operations; invalid command
inputs are `ValkeyCacheInputError` values. Callers retain their authoritative
fallback and may not use a cache error to weaken a trading guard. The workload's
ConfigMap, password and TLS Secret references are optional so missing cache
artifacts cannot block authoritative service recovery.

`node dist/valkey-command.js` verifies miss, write/read, deletion and expiry using
synthetic keys with the same client. Configuration comes from
`bayn-valkey-connection`, the existing password Secret and mounted client TLS
material. Cache-client acceptance is separate from economic qualification.

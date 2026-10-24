# Bayn system review — 18 October 2026

> **Archived record.** This is a point-in-time snapshot, not current guidance. Its deployed image, accounting
> totals, strategy parameters and research priorities describe 18 October 2026 and have since been superseded. See the
> [archive index](README.md) for the current sources of truth.

## Decision

Admit and finalize a Jev batch in one atomic PostgreSQL statement when every candidate is already excluded. No inference result remains to be collected in that case. The change preserves the validated plan, result schema, decision exclusions, expiry checks and recovery behavior while removing a separate finalization transaction.

The broader research priority is independent reproduction of the information available at each decision. Bayn already has native replay, cost models, simple controls and several unsuccessful strategy studies. Missing original arrival and control-timing evidence limits stronger conclusions. An engine migration or another parameter sweep cannot recreate those records.

This is a pre-rollout research and qualification record. The originating pull request is the place to retain the subsequent CI, immutable image, Kargo, Argo and live verification receipts. The archive and timing exporter discussed below are proposed work, not deployed components of this change.

## Current system and evidence

The inspected source is [87b6a14db2650c7eb5caed66c6e67dc4a7896f1b](https://github.com/proompteng/lab/commit/87b6a14db2650c7eb5caed66c6e67dc4a7896f1b).
The deployed image at the initial readback was
sha256:8fb29b4cb998d80b3133918d83bd8281986bfc892f674b7c7f6f5e88b93e9581.
The [machine-readable evidence](../evidence/2026-10-18-atomic-abstention.json) retains the bounded operational snapshot, aggregate query, scope and local qualification results.

| Component                             | Current role                                                          | Consequence for this review                                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Dorvud, Kafka and streaming snapshots | Produce and validate market features and source identity              | Preserve original messages and arrival context before making stronger replay claims.                         |
| ClickHouse                            | Retained signal/archive reads                                         | Keep the runtime connection read-only; research must identify historical availability.                       |
| Restate and PostgreSQL                | Durable account execution, immutable observations, claims and results | Optimize the existing evidence lifecycle without weakening ownership or recovery.                            |
| Jev and TypeSafe inference            | Evaluate eligible candidates under the single strategy protocol       | Validate the reported decision and net economics; ranking probabilities are not calibrated return forecasts. |
| Valkey                                | Broker-state projections                                              | Preserve freshness and exact reconciliation requirements.                                                    |
| TigerBeetle                           | Ledger/accounting evidence                                            | Continue reconciling each fill, accounting transaction and receipt.                                          |
| Alpaca sandbox                        | Existing paper execution environment                                  | Simulated fills cannot establish executable live-market edge.                                                |
| OpenTelemetry and operational status  | Execution-stage and health evidence                                   | Use independent timing records for claims about latency and information availability.                        |

These roles are described in the [service README](../../../services/bayn/README.md), [batch store](../../../services/bayn/src/db/jev-batch-postgres.ts), [protocol](../../../services/bayn/src/jev/protocol.ts), [archive design](../market-data-archive.md) and [matched-entry study](../matched-entry-study.md).

### Operational baseline

At 07:20:25 UTC, the native status readback was READY, with exact reconciliation, zero discrepancies, no open orders or positions and no unfinished cycles. The active session was abstaining and the latest decision was NO_TRADE. This establishes functioning operation at that observation; it is not evidence of profitable operation.

| Retained accounting measure                       |              Value |
| ------------------------------------------------- | -----------------: |
| Fills / accounting transactions / ledger receipts |    539 / 539 / 539 |
| Realized closes                                   |                348 |
| Unaccounted / unreceipted fills                   |              0 / 0 |
| Gross realized P&L                                |       −$431.211644 |
| Fees                                              |      $1,212.634501 |
| Net realized P&L after fees                       | **−$1,643.846145** |
| Forward-performance qualification                 | No result reported |

The current strategy has a 15-minute horizon/maximum hold, 50-basis-point stop, one-position limit and allocation capped at 20% of equity. Entry requires the existing validated source and momentum conditions and the supported net-economics decision. No evidence in this review supports changing these constraints. Source eligibility, authority, capital grants, reconciliation, risk and order controls retain their existing enforcement.

Crypto economics are material at this horizon. The existing execution model includes a 25-basis-point coin charge on entry and a 25-basis-point rounded cash charge on exit. An earlier **19-round-trip** sample recorded price P&L of −$197.251644, fees of $1,182.554501 and net P&L of −$1,379.806145. Its scope differs from the later 539-fill accounting snapshot; the two samples must not be combined as though they were one decomposition. See [net-edge research](../net-edge-research.md) and [17 October crypto research](../crypto-entry-research-2026-10-17.md).

### Existing strategy research

The 17 October work screened six catchup, washout and breakout variants against approximately 1.1 million bars, 373,000 prints and 3.5 million quotes, with 624 observations in the extended study. No sufficiently supported candidate survived its training criteria. These results belong in the experiment inventory.

Bayn also contains a native seven-feature ridge control, retrospective equity screens across 13 policies, and a matched-entry comparison of immediate momentum, delayed momentum and Jev under common exits. The research documentation records the original-arrival and independent timing gaps. Retrospective source correctness and reproducible arithmetic are useful; they do not establish that each input was available to the live process at the historical decision instant.

The [prior research review](../recent-strategy-research-2026-10-06.md), [study export](../study-evidence-export.md), [matched-entry study](../matched-entry-study.md), and [archive design](../market-data-archive.md) are the relevant history. The appropriate response to unsuccessful screens is to retain them and improve subsequent evidence, rather than silently increasing the search space until an attractive backtest appears.

## The measured persistence opportunity

At 07:47:54 UTC, a read-only PostgreSQL transaction with a five-second statement limit inspected the latest authority generation since 07:00 UTC.

| Measurement                                            |                Observed value |
| ------------------------------------------------------ | ----------------------------: |
| Batches                                                |                            26 |
| Observation-time span                                  | 07:14:20.806–07:47:26.603 UTC |
| All-excluded batches                                   |                   18 (69.23%) |
| Pending batches                                        |                             0 |
| All-excluded plan/result rows sharing a transaction ID |                             0 |
| Candidates excluded for momentum                       |                            61 |
| Candidates excluded as not ready                       |                             9 |
| Requested candidates                                   |                             8 |
| All-excluded observation → result completion, median   |                      1,369 ms |
| Same interval, 95th percentile                         |                    2,349.8 ms |

The all-excluded path is common in this bounded sample. The zero pending count also matters: this was avoidable work, not evidence of a growing backlog or a broken finalizer.

The timing interval ends at the application's recorded result completion time. It does not measure durable commit acknowledgment, broker latency or a causal effect of the patch. The new path records completion at the admission check, which changes that timestamp boundary. A before/after comparison of this field must not be marketed as an independent end-to-end latency improvement.

### Implementation and guarantees

Previously, admission committed a plan and a later no-request finalizer committed its result. The new branch follows the same source reproduction, existing-record lookup and clock checks. It constructs the result through the existing canonical result function and executes:

```sql
WITH admitted AS (
  INSERT INTO jev_batch_plans (...)
  VALUES (...)
  ON CONFLICT (batch_id) DO NOTHING
  RETURNING batch_id
)
INSERT INTO jev_batch_results (batch_id, result_hash, payload)
SELECT admitted.batch_id, ..., ...
FROM admitted;
```

Only the invocation inserting a new plan receives an admitted row. A competing retry cannot overwrite the retained result. If result insertion fails, the whole statement rolls back, including its new plan. The subsequent read returns the committed evidence.

An older unfinished plan remains owned by the existing recovery path. A completed batch can still be replayed after expiry. A new, uncommitted batch still fails at a regressed clock or its expiry boundary. Any batch containing requested candidates follows its prior admission path.

Completing exclusion evidence does not expand which reasons can authorize a no-entry decision. Missing source evidence remains subject to the existing decision checks. The change neither requests inference for excluded candidates nor invents requests, receipts or trading actions.

### Qualification

The initial regression run against disposable PostgreSQL 18 reproduced three expected failures and passed the two legacy-recovery/clock checks. After the implementation:

- The complete batch integration suite passed 34 tests before the last additional regression.
- The final focused suite passed six regressions and 44 assertions.
- The full service suite passed 3,344 tests, skipped 535 environment-dependent cases and had zero failures.
- TypeScript, formatting, ordinary lint, typed lint and build passed. Existing lint warnings were outside the changed files.

The added cases cover complete admission, result-insertion failure, competing new admissions, loss of a new admission acknowledgment, older pending plans and clock/expiry rejection. The success case checks matching PostgreSQL xmin values for the plan and result, zero evaluation requests, and reuse without inference or another finalization.

Independent review of the returned source/test diff found no blocking issue. The PostgreSQL tests ran with the full migrations. These checks substantiate the targeted transaction and recovery behavior; they do not establish stronger durability configuration, trading edge or a numerical production speedup.

## Whitepapers and research practice

### Account for every trial

[The Deflated Sharpe Ratio](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf) addresses selection across trials and non-normal returns. Its application requires suitable sample statistics and a defensible treatment of the trial distribution.

For Bayn, retain each policy, parameter choice, data window, cost assumption and failed screen. Do not treat a small dependent sample, an arbitrary independent-trial count or a single winning backtest as statistical qualification.

[The Probability of Backtest Overfitting](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) examines the stability of in-sample selection out of sample. It is useful when comparable trials and sufficient observations exist. It cannot repair execution bias or recover missing market records.

### Respect event intervals and availability

[The 10 Reasons Most Machine Learning Funds Fail](https://www.garp.org/hubfs/Whitepapers/a1Z1W0000054x6lUAA.pdf) discusses overlapping-label leakage and the need for purging and embargo.

Bayn should associate labels with their actual entry-to-outcome intervals and exclude outcomes not yet mature or available at each historical cutoff. A 15-minute maximum hold does not make a fixed row gap universally correct. Assess richer models against existing simple controls using the same causal inputs, costs and complete selection history.

These are methodology improvements, not just additional scores to append to an already selected winner. Freeze prospective hypotheses, economic thresholds and stopping rules before new evaluation windows.

## Professional tooling choices

### Preserve the source stream independently

The last archive inspection documented 35-day Kafka retention and no independently deployed Kafka Connect S3 sink. That is a retained recovery window, not proof of a durable, complete research archive.

The [Aiven connector](https://aiven-open.github.io/cloud-storage-connectors-for-apache-kafka/s3-sink-connector/index.html) supports an independent Kafka-to-object-storage path. Prefer topic/partition/start-offset grouping and a JSONL envelope with byte-array converters for keys, values and headers. Key grouping compacts history, and CSV cannot distinguish null from empty fields in the required way. The connector requires Java 17 or newer. These choices require a restore test on the installed object store.

The [v3.4.3 release](https://github.com/Aiven-Open/cloud-storage-connectors-for-apache-kafka/releases/tag/v3.4.3), published 8 September 2026, is pinned to a679101ce07c513266f76bc5237a8b2131fa0f7a. It changes S3 support to AWS SDK 2 and multipart uploads. The published archive digest is b92106a67e936b5c9ac5811cec9cabd53d3503ca15253ccbfc44cda88119371e. This review inspected release metadata; it did not download or run that connector archive.

Treat delivery and restoration as an at-least-once process. Deduplicate by topic, partition and offset; reject different bytes for one identity. Preserve nulls, tombstones and duplicate headers. Record Kafka timestamp type and path provenance separately where the chosen output does not carry them. A sink does not by itself establish immutable storage or complete recovery.

The acceptance test must exercise actual Ceph reads/writes, interrupted multipart uploads, upload-before-offset-commit replay, arbitrary binary payloads and independently verified partition watermarks. The archive should start from the retained offsets available at deployment and state which earlier history is already lost.

### Capture timing that belongs to Bayn

An archive cannot reconstruct Bayn's local receipt sequence, merge order across partitions or the time a control acknowledgment took effect if those facts were never recorded.

[Databento](https://databento.com/docs/standards-and-conventions) distinguishes event, receive and gateway timestamps. [NautilusTrader](https://nautilustrader.io/docs/latest/concepts/data/) distinguishes event and initialization time and specifies stable initialization-time ordering for backtests. These conventions illustrate why one timestamp cannot stand in for every availability boundary.

Use existing trace annotations to build an independent record of source offsets, process epoch, local sequence, effective control identity, feature cutoff, quote identity and terminal batch evidence. Keep the observer separate from trading-worker storage waits. Validate restart continuity and cross-partition ordering. Existing native study exports then become more useful because their inputs can be tied to original availability.

### Use an independent engine for a defined comparison

[LEAN core](https://github.com/QuantConnect/Lean) is an Apache 2.0 event-driven engine suitable as a reference implementation. Its [reconciliation documentation](https://www.quantconnect.com/docs/v2/writing-algorithms/live-trading/reconciliation) describes data, timing, normalization and fill differences between backtest and live operation.

Use it to investigate a specific discrepancy after matching Jev lifecycle rules, feed identity, actual fees and rounding, hold/stop timing, partial fills and restart behavior. A wholesale migration would introduce translation work before resolving the evidence gap. The documented [LEAN CLI Alpaca workflow](https://www.quantconnect.com/docs/v2/lean-cli/live-trading/brokerages/alpaca) requires paid organization membership and login; using the open-source core directly is a separate route.

NautilusTrader is another useful design reference. Alpaca was not listed on the official [integrations page](https://nautilustrader.io/docs/latest/integrations/) inspected for this review. A migration would therefore require adapter investigation as well as strategy translation.

[Alpaca's market-data FAQ](https://docs.alpaca.markets/us/docs/market-data-faq) distinguishes free live IEX from recent/latest SIP access. Later historical SIP cannot silently replace unavailable live inputs. Its [paper-trading documentation](https://docs.alpaca.markets/us/docs/paper-trading) describes limitations involving impact, latency, queue position and quoted quantity. Paper execution remains valuable for lifecycle verification while executable net edge requires stronger evidence.

## Autonomous skill installation and application

The repository now contains [autonomous-agents](../../../skills/autonomous-agents/SKILL.md) from
[sickn33/antigravity-awesome-skills](https://github.com/sickn33/antigravity-awesome-skills/tree/c564f9f4aee8a143c48218805b65f0f6956c6264/skills/autonomous-agents),
pinned to c564f9f4aee8a143c48218805b65f0f6956c6264.

The complete skill and guide were read before use. Upstream licensing and provenance are retained. Only metadata placement changed for Codex compatibility; the guide and workflow text remain intact. The standard skill validator passed, and the unchanged guide's Git blob identity matches bba8df987b388a410b5364141941a0b8d5c38bbe.

The applied workflow is scoped planning, evidence-based execution, bounded retries, independent review and durable checkpoints in Git and the delivery record. The reference SDK snippets are not installed dependencies. No new hook or background agent runner is registered. This installation does not change the authority of Bayn's broker, account or capital controls.

## Delivery and subsequent research acceptance

| Stage                 | Required evidence                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current atomic change | Reviewed source, required CI, immutable build image, matching Kargo Freight and generated branch, Argo sync/health, ready runtime and new-generation batch evidence. |
| Recovery behavior     | Complete new all-excluded batches; older pending plans retain their normal recovery; no repeated inference or fabricated result after failures.                      |
| Independent archive   | Exact restored bytes and metadata, tested restarts/multipart behavior, detected conflicting duplicates and partition gaps.                                           |
| Archive completeness  | Retained starting offsets and independently readable watermarks, with lost earlier history identified.                                                               |
| Timing journal        | Reproducible decision ordering and effective controls through restarts and cross-partition delivery.                                                                 |
| Prospective research  | Mature labels, event-interval purging, availability cutoffs, simple controls, actual costs and complete trial accounting.                                            |
| Independent engine    | Same archived inputs and accounting conventions for a defined comparison before migration is considered.                                                             |

The immediate result is a simpler persistence path for an already determined set of exclusions. The next trading research claim must be supported by original data availability, execution economics and prospective evidence.

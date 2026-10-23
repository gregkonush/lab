# Harness2 refinement of Jev decisions

Bayn uses [Google Research Harness2](https://github.com/google-research/harness2) at revision
`1cfe254e8d25b15f37048c3730134686abe60335` to refine the question instructions consumed by its native Jev decision
path. The former Alpha-R1 factor-selection adapter and its study format are removed.

The runner generates candidate instructions and compares native decisions. Independent native portfolio evaluation
measures their economic effect; editor preferences and decision changes do not establish improvement. The
[design audit](harness2-design-audit-2026-10-20.md#optimizer-recommendation-rechecked-october-22) recommends a
metric-driven optimizer for the next instruction-search experiment. The active implementation remains Harness2.

## Model roles and decision ownership

Jev remains the typed decision model. Every probe uses the production `JevClient`, pinned model, HTTP endpoint,
response validation, proxy and ten-second request timeout. Probes reconstruct state and supplied answer choices from
an original native Bayn observation. The baseline instructions must match the compiled live instructions exactly.

Harness2 edits only `instructions.json`, containing one `entry` string of at most 2,000
characters. This is the conditional complete-plan question instruction used by `trade-plan-choices.ts`.
The independent current-setup question remains source controlled and cannot be replaced by an editor's plan instruction.
The editor sees a bounded summary with original request hashes, relative returns, break-even economics, candidate
and benchmark returns, price ranges, quotes, and selected answers. Unrepresented fields never establish missing
facts. Each signal group remains represented for the full candidate universe.
Raw bar histories and full probability distributions remain in native receipts and are omitted from the editor view;
Jev receives the complete original state. The editor cannot change question types, candidate prices, market state, position sizing, account limits, freshness,
broker protection or execution authority. Bayn's shared `selectJevEntryCandidates` function converts the typed answers
into the same funded selections and protection-plan rejections used by the live strategy.

The pinned Qwen3-8B general instruction endpoint serves as the generative editor and reflection writer. It does not execute probes,
select factors or make trading decisions. Editor calls retain signed native registrations, original SSE bytes,
serving identity, usage and expense evidence through the existing Restate workflow. The worker accepts only the
`bayn.jev-harness2-editor.v3` contract. Prompt edits use vLLM's JSON Schema response format, derived from
`JevInstructionsSchema` with extra properties forbidden. The provider returns only the complete `{"entry":"..."}`
document. The native stream decoder and Python adapter both reject wrappers, XML tags, notes, missing fields and
invalid instruction strings. Reflection keeps its separate evidence format. Retired v2 requests remain readable
for receipt and expense verification, but cannot be submitted or dispatched. Historical Alpha-R1 editor and factor registrations remain immutable accounting evidence; their
formats cannot be submitted for new inference through the command or deployed worker.

The active trading exit path enforces the protection terms selected before entry. This experiment does not optimize
an unconsumed management question. It never submits broker orders or changes capital authority.

## Register and run

Use `bayn-harness2-probe --baseline` to obtain the compiled instructions. Supply original observations exported from
Bayn, preserving their protocol, source rows, timestamps and account context. Verify their content hashes against the
native export or database receipt. Keep all inputs and outputs private.

```json
{
  "schemaVersion": "bayn.jev-harness2-study.v1",
  "sourceRevision": "<exact deployed source revision>",
  "maximumCalls": 128,
  "maximumWallSeconds": 1800,
  "baseline": { "entry": "..." },
  "editor": { "policy": {}, "costBasis": null },
  "tasks": [{ "id": "development", "observation": {} }],
  "validation": [{ "id": "untouched", "observation": {} }]
}
```

Use the deployed `BAYN_RESEARCH_INFERENCE_POLICY` as the editor policy. It pins the generative serving and decoding
identity and has no factor-selection limit. Do not put credentials in the manifest.

A study supports one to four ordered development observations and one to 32 ordered validation observations. The
first validation observation must follow the last development observation by at least the full 15-minute holding
horizon. The manifest freezes both sets before model work. Validation state and outputs never enter proposal,
composition or reflection context. The final composed instruction bytes are frozen before the validation calls.

The installed command runs one real upstream Propose–Probe–Compose step per development observation:

```sh
bayn-harness2 --manifest /tmp/study.json --output /tmp/jev-harness2
```

Run it in the research worker's existing environment. It uses the existing research approval key, restricted
Restate database identity, private object-store credentials, proxy, and the same Jev API credential as Bayn.
A native probe can be inspected separately:

```sh
bayn-harness2-probe --validate /tmp/probe.json
bayn-harness2-probe --run /tmp/probe.json --output /tmp/new-receipt.json
bayn-harness2-probe --verify /tmp/probe.json --receipt /tmp/new-receipt.json
```

`--validate` requires the exact compiled baseline. `--run` accepts a bounded candidate instruction document. It
reproduces the original observation and fixes every other request field. Its receipt retains the original and
candidate request hashes, typed responses, provider usage, inference timing and native funded decision. Verification
recomputes the request, response and decision bindings. Receipt `bayn.jev-harness2-receipt.v2` also retains native
candidate exclusions with their symbols, reasons and messages. These are reproduced during verification and shown
to the editor without provider dispatch. An all-excluded observation therefore remains distinguishable from Jev
choosing to abstain. The installed image rejects a different source revision.

## Reservations, recovery and artifacts

The private prefix `harness2/jev-v1/<studyId>/` retains the frozen registration, call reservations, receipts,
upstream artifacts, candidate and comparison. `studyId` is the SHA-256 of compact, sorted-key UTF-8 manifest JSON.
Conditional object creation requires existing bytes to match. Local outputs are also namespaced by study ID.

`maximumCalls` bounds reserved provider requests, including every candidate in a native probe batch and each editor
request. Excluded candidates can make the actual count smaller than the reserved budget. Calls execute sequentially
inside a probe. Each invocation receives a new bounded research window; original market timestamps remain frozen.
These calls are offline reevaluations and do not prove historical execution latency.

A reservation precedes transmission. An ambiguous Jev probe cannot be retransmitted under the same or a fresh slot
within that study. Partial private response files remain evidence of attempted work. A completed receipt can be read
and verified without model work. Editor recovery uses its original durable Restate identity. Resume interrupted
studies with their original image and output directory. Completed studies return their retained terminal report.
Retain inconclusive attempts; a new experiment requires a new explicit registration.

## What the comparison establishes

The report separates engine completion, changed native decisions and economic improvement. It compares baseline and
candidate funded selections, quantities, protection plans and rejection reasons on the same hidden observations.
A probability change that leaves the native selection and plan unchanged does not count as a changed decision.

Before reflection, the adapter hashes the selected instruction document and every compared candidate against the
baseline. If all instruction documents match, it records `instruction-comparison.json`, skips the generative
reflection call and returns `NO_ENTRY`. Provider output differences under unchanged instructions cannot create a
successful-edit lesson in the upstream library. A rejected candidate with changed instructions remains available
for reflection even when the selected document is the baseline.

`NO_OBSERVED_CHANGE` means every paired validation probe completed and produced the same native decision.
`INCONCLUSIVE` includes changed decisions without independent outcome evidence, incomplete calls or missing pairs.
A different choice, more entries, fewer rejections, a composed prompt or a successful model call does not establish
better decisions. The report never labels these observations profitable.

Economic improvement remains `UNPROVEN` until the candidate has an independent comparison with closed execution
outcomes, complete execution, inference and operating costs, realistic timing and capacity, and untouched evaluation
sessions. Recorded flat-entry observations are policy-selected and do not establish coverage of every market
opportunity. Do not sum overlapping opportunity labels into portfolio returns. Jev's `P(enter)` is not automatically
the probability of a profitable trade.

Jev research usage and all retained responses are recorded, but its price allocation remains unknown in this
experiment. `costPicoUsd` is null when any call lacks a complete cost basis. Missing costs never become zero.
Every study remains `UNQUALIFIED`. Promotion requires an evidence-backed reviewed change to the compiled
`jev/instructions.ts`, with the normal strategy/protocol identity migration and existing authority gates. The runner
does not install candidates into the trading process.

## Compile a native portfolio variant

The research compiler replaces the data-only `src/jev/instructions.ts` module before bundling the ordinary
`backtest-command.ts` entry point. Every request builder, decision decoder, persistence path and recovery check
therefore consumes the same frozen instruction document. The trading build has no environment or request switch
for this instruction. The compiler accepts one string as data and has no editable source path or executable-code
parameter.

Use the pinned Bun 1.4.2 toolchain and committed source. The compiler verifies the requested Git revision and clean
consumed inputs both before and after compilation. It fails if the instruction module is not replaced exactly once.
Create a private specification:

```json
{
  "schemaVersion": "bayn.jev-harness2-variant.v2",
  "sourceRevision": "<exact reviewed source revision>",
  "imageRepository": "registry.ide-newton.ts.net/lab/bayn",
  "baseImageDigest": "sha256:<runtime image digest>",
  "instructions": { "entry": "..." },
  "dependencyReceiptSha256": "<exact image dependency-receipt SHA-256>"
}
```

Compile from the repository root:

```sh
bun services/bayn/tools/build-jev-harness-variant.ts --spec /tmp/variant.json --dependencies /tmp/image-dependencies.json --output /tmp/new-variant
```

`build.json` binds the specification, baseline and candidate instruction hashes, source revision, compiler version,
unchanged strategy hashes and exact executable SHA-256. It is evidence from the compiler invocation, not a signed
attestation. Verify its bytes and trusted producer independently. The base image requires deployed runtime readback;
a successful local compilation does not establish that image's publication or execution. The Nix build records every bundled dependency file and its package metadata in
`/app/services/bayn/dist/jev-compiler-dependencies.json`. Extract that exact file from the verified base image and
freeze its raw SHA-256 in the specification and economic registration. The public build command first bundles its
own implementation against the image's separate `compilerFiles` inventory, then imports only that verified bundle.
It loads no local Effect dependency before this check. The compiler hashes the exact bytes supplied
to Bun's loader, rejects changed or missing dependencies, and requires the same complete import graph. A clean Git
status alone does not establish dependency identity.

The compiler does not link the checkout's runtime dependencies into its output. Execute every arm inside the exact
verified base image, with the compiled executable copied unchanged into a private temporary directory and
`node_modules` linked to that image's `/app/services/bayn/node_modules`. Use isolated local replay stores and retain
the running container's image identity. This keeps the external native adapter closure pinned as well as the bundled
JavaScript inputs. A host dependency tree is not an accepted execution environment.

The normal image installs `bayn-backtest` for the reviewed baseline. Candidate executables use the same native
command arguments. Each arm needs its own empty local PostgreSQL replay database, local TigerBeetle target,
unique replicate identity and private output directory. Never target the restricted research worker's production
database. It has no permission to produce native portfolio replays.

Input `bayn.backtest.v5` binds `jevInstructionsHash` to the compiled document and `inference.maximumCalls` to the
provider dispatch ceiling. All other inputs, capital, market sources, cadence, risk and execution assumptions stay
fixed across arms. The provider uses the existing Jev credential and `BAYN_PUBLIC_INFORMATION_PROXY` adapter.
Declare `allocatedDataCostPerSessionMicros: null` when the data allocation is unpriced. The native report retains
null data expenses, marks every affected session incomplete, and withholds net results and qualified drawdown.
It still records execution outcomes and equity after known costs. Missing expenses never become a zero allocation.
Control comparisons and net-label training require priced data and reject this unknown allocation.
Failed or interrupted dispatches consume their budget; exhausted slots cannot transmit. Report
`bayn.backtest-report.v4` records the compiled instructions, provider dispatch inventory and native outcomes.
The command retains its actual executable hash and writes full evidence privately; stdout contains a small summary.
Economic comparison requires this digest for every arm. Raw engine reports without an identified executable cannot
enter the comparison. The unchanged-prompt repeat must use the exact baseline executable digest.
The candidate must change both the instruction hash and executable digest. An unchanged proposal remains a no-change
proposal outcome and cannot be scored as a distinct candidate arm.
Broker operations use the simulated broker. This command acquires no Alpaca trading credential and expands no capital authority.

## Native economic report comparison

One existing market session is enough for a bounded native comparison. Reuse the same source, calendar, execution
assumptions and risk code, freeze the question before examining outcomes, and report execution P&L, metered costs,
drawdown and unresolved evidence. Unknown allocations remain null. The separate prospective-adoption protocol is
not a prerequisite for this experiment, evaluator delivery or a negative result. A repeated baseline is another run
of the same session, not a requirement to collect another market date. The three-arm command below includes that
repeat to expose unchanged-question variation; a two-arm readout cannot attribute its entire delta to wording.

The native command can compare reports from three independent full backtest runs: the unchanged baseline,
an unchanged-prompt repeat, and the frozen candidate. It reads existing reports; it does not generate candidate
backtests or obtain market coverage. The proposal runner does not yet orchestrate this boundary.

```sh
bayn-harness2-probe --compare /tmp/economic-manifest.json --output /tmp/new-comparison.json
```

The manifest uses `bayn.jev-harness2-economic-manifest.v2`. Its `registration` contains `studyId`,
`evaluatorSourceRevision`, `compilerDependencyReceiptSha256`, `registeredAt`, the `baseline` and `candidate` instruction documents, ordered
`sessionDates`, and `maximumDrawdownMicros`, with registration schema
`bayn.jev-harness2-economic-registration.v2`. Each of `baseline`, `baselineRepeat` and `candidate` contains a
`reportPath`, its exact file `reportSha256`, and ordered `operatingAllocations`. Each allocation names its
`sessionDate` and separate `infrastructure` and `research` entries: either null, or `{costMicros, evidenceHash}`.
Unknown allocations remain null. A zero allocation requires evidence just as a nonzero allocation does.
The candidate also requires `buildReceipt: {path, sha256}` for the compiler-produced `build.json`. Its raw file digest,
canonical receipt hash, exact executable, instructions, source, base image and strategy identities must reproduce.
The terminal comparison hash binds that receipt. This consistency check does not authenticate the compiler producer;
verify the clean source and actual executable independently.

The command checks each complete original report hash before decoding its economic projection. It reproduces
request and response identities, instruction identity, provider timing bounds, per-session inference inventories,
declared-tariff expenses, cash, inventory, execution fees and net equity carry. Each native report retains and hashes
the complete normalized backtest input, excluding only the replicate identity and instruction hash. That comparison
identity includes fractional trading, broker assets, calendar, cadence and every other replay input. It must match
across arms alongside source, initial capital, strategy, execution assumptions, tariff and dates. Reports are read sequentially, with a
64 KiB manifest limit and a 16 MiB limit for each report. Larger native outputs require a deliberate streaming
consumer; they cannot be truncated to fit. Outputs use exclusive creation and private file permissions.

The resulting `observedNetEffect` describes higher, lower or unchanged native replay net totals. It retains every
paired session and the unchanged-prompt repeat delta. Missing outcomes or allocations make the comparison
inconclusive. Operating allocations are additional to native execution, inference and data costs. The
comparison hash also binds each arm's operating-allocation evidence hashes, even when their prices are equal.
Received and failed dispatches must reproduce the declared call count; explicit undispatched calls consume no
provider slot. Interruptions and defects can leave dispatch ambiguous and already withhold complete cost outcomes.
The drawdown bound adds their entire nonnegative total to native drawdown, which is conservative when their precise
intraday booking path is unavailable. Hashes detect altered bytes; they do not authenticate a producer or prove
the source/accounting graph. Declared registration time also requires independent immutable evidence.

The command needs no provider, broker or database configuration. It always reports `economicImprovement: UNPROVEN`,
`qualification: UNQUALIFIED` and `adoption: NOT_AUTHORIZED`. It defines no new statistical acceptance rule. The
[frozen acceptance protocol](jev-migration-acceptance-v2.json) remains a separate numerical gate at its specified
scope. A model-backed experiment still needs candidate production, independent source coverage, full controls,
untouched sessions, cost evidence and prospective confirmation before an improvement claim.

## Validation and rollout

Python tests execute the pinned upstream engine against a deterministic CLI boundary. Native TypeScript tests
prove baseline request identity, parity with the live funded entry selector, immutable state/choices, and rejection
of altered receipts. These fixtures establish implementation behavior only.

```sh
python -m unittest discover -s services/bayn/harness2 -p 'test_*.py' -v
bun test services/bayn/src/jev/harness2.test.ts
```

Roll out through reviewed main, immutable publication, `lab-delivery/bayn`, `kargo/bayn` and Argo. Migration 135 admits
the general editor registration while preserving historical evidence. Verify the exact image, native installed command,
real Jev probe receipts, held-out comparison, private object readback and completed-study replay. Confirm accounting,
reconciliation and trading safeguards independently. Infrastructure readiness alone is insufficient.

# Harness2 refinement of Jev decisions

Bayn uses [Google Research Harness2](https://github.com/google-research/harness2) at revision
`1cfe254e8d25b15f37048c3730134686abe60335` to refine the question instructions consumed by its native Jev decision
path. The former Alpha-R1 factor-selection adapter and its study format are removed.

## Model roles and decision ownership

Jev remains the typed decision model. Every probe uses the production `JevClient`, pinned model, HTTP endpoint,
response validation, proxy and ten-second request timeout. Probes reconstruct state and supplied answer choices from
an original native Bayn observation. The baseline instructions must match the compiled live instructions exactly.

Harness2 edits only `instructions.json`, containing `entry`, `stopLoss` and `takeProfit` strings of at most 2,000
characters each. These are the actual question instructions used by `trading-signals.ts` and `trade-price-choices.ts`.
The editor sees a bounded evidence summary with the original request hashes, bounded computed-signal excerpts and selected answers. Excerpts can be truncated and never establish missing facts.
Raw bar histories and full probability distributions remain in native receipts and are omitted from the editor view;
Jev receives the complete original state. The editor cannot change question types, candidate prices, market state, position sizing, account limits, freshness,
broker protection or execution authority. Bayn's shared `selectJevEntryCandidates` function converts the typed answers
into the same funded selections and protection-plan rejections used by the live strategy.

The existing Alpha-R1 endpoint serves only as a generative editor and reflection writer. It does not execute probes,
select factors or make trading decisions. Editor calls retain signed native registrations, original SSE bytes,
serving identity, usage and expense evidence through the existing Restate workflow. The worker accepts only the
`bayn.jev-harness2-editor.v1` contract. Historical factor registrations remain immutable accounting evidence; their
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
  "baseline": {"entry": "...", "stopLoss": "...", "takeProfit": "..."},
  "editor": {"policy": {}, "costBasis": null},
  "tasks": [{"id": "development", "observation": {}}],
  "validation": [{"id": "untouched", "observation": {}}]
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
recomputes the request, response and decision bindings. The installed image rejects a different source revision.

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

## Validation and rollout

Python tests execute the pinned upstream engine against a deterministic CLI boundary. Native TypeScript tests
prove baseline request identity, parity with the live funded entry selector, immutable state/choices, and rejection
of altered receipts. These fixtures establish implementation behavior only.

```sh
/tmp/bayn-harness2-venv/bin/python -m unittest discover -s services/bayn/harness2 -p 'test_*.py' -v
bun test services/bayn/src/jev/harness2.test.ts
```

Roll out through reviewed main, immutable publication, `lab-delivery/bayn`, `kargo/bayn` and Argo. Migration 132 admits
the new editor registration while preserving historical evidence. Verify the exact image, native installed command,
real Jev probe receipts, held-out comparison, private object readback and completed-study replay. Confirm accounting,
reconciliation and trading safeguards independently. Infrastructure readiness alone is insufficient.

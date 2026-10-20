# Harness2 research refinement

Bayn runs [Google Research Harness2](https://github.com/google-research/harness2) at revision
`1cfe254e8d25b15f37048c3730134686abe60335` through `bayn-harness2` in its existing image.
The command refines Alpha-R1 factor-selection instructions. It does not change Jev, submit orders, activate a
mandate, or promote its output into trading. Candidate promotion still requires the existing registered comparison,
complete costs, untouched outcomes, reviewed source change, and authority gates.

## Execution contract

The adapter calls upstream `run_domain` with one sequential Propose–Probe–Compose step per task. The baseline,
two proposed prompt variants, composed prompt, execution traces, and experience library are real Harness2 artifacts.
Only `systemprompt.md` is editable, with an 8,000-character bound. Model text is never executed as code. Scripts,
plugins, tools, and subagents are excluded. The upstream OpenCode prompt format is used for evidence construction;
neither OpenCode nor Codex is launched.

Every probe, editor, composer, and reflection request uses `bayn-research`. That command signs the exact run with
the existing research approval key, submits through Restate, and verifies the receipt against the original SSE bytes.
The existing research worker enforces its pinned Alpha-R1 serving identity and decoding policy, one in-flight model
request, durable claims, deadlines, usage, allowed factor IDs, and expense projection. Editor and reflection responses
must also contain a valid factor list. They additionally return the requested `<harness>` or experience tags.

The study freezes one to four ordered tasks, 8–32 model-call reservations, and a 60–3,600-second wall-time budget.
Each task contains an existing `bayn.research-run.v1` registration. Its original context must pass Bayn's validator
before any inference. An ordinary one-task run uses eight model calls. Invalid proposals can consume additional
reservations within the same budget. Transport failure never authorizes another registration for the same call.

This is offline refinement. Each invocation receives a new bounded inference window, while the original task context,
descriptions, timestamps, hashes, source revision, policy, study, arm, and capture references remain frozen. Refinement
latency cannot establish that an original intraday decision was feasible. No future return labels or economic scores
are supplied to Harness2.

## Run a registered study

Create a manifest with this shape. Replace `run` with a complete registration from the
[research contract](alpha-r1-research-plan.md), including the exact deployed source revision and serving policy.
Tasks in the same study share the initial prompt. Keep their original feature cutoffs in chronological order.

```json
{
  "schemaVersion": "bayn.harness2-study.v1",
  "maximumCalls": 12,
  "maximumWallSeconds": 1800,
  "tasks": [
    {
      "id": "registered-factor-selection",
      "run": {}
    }
  ]
}
```

Use the deployed `bayn-research` worker's existing environment. It supplies the research approval key, restricted
database-backed Restate API, private bucket name, and reflected object-store credential. The command needs
`RESTATE_INGRESS_ORIGIN`, `BAYN_PUBLIC_INFORMATION_BUCKET`, `BAYN_PUBLIC_INFORMATION_STORAGE_ENDPOINT`,
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `BAYN_RESEARCH_APPROVAL_KEY`. Do not copy credentials into the manifest.

```sh
bayn-harness2 --manifest /tmp/study.json --output /tmp/harness2-study
```

Local artifacts live under `<output>/<studyId>/`, so separate manifests cannot reuse another study's upstream cache.

The private prefix `harness2/v1/<studyId>/` retains the manifest, original per-call registrations, verified receipts,
upstream artifacts, and terminal result. `studyId` is the SHA-256 of compact, sorted-key UTF-8 JSON for the manifest.
Object creation uses `If-None-Match: *`; a conflict must read back identical evidence. Call slots are reserved before
transmission. A restart reuses the original registration and its native Workflow identity, including an ambiguous
claim. It cannot generate a new model request for that call. Use the same output path when resuming an interrupted
study. Completed studies return their retained result without model work. A terminal inconclusive study requires an
explicit new registration for a new experiment.

The top-level result records exact integer `costPicoUsd` only when every reserved attempt has priced evidence.
Missing receipts or an unknown cost basis leave it null. Upstream floating-point session-cost fields are diagnostic
metadata and are not Bayn accounting evidence. Allocated research inference cost alone does not cover preparation,
shared capacity, data, or trading costs.

`COMPLETE` means the refinement produced its artifacts without upstream fallback or incomplete model receipts.
It does not mean that the composed prompt improves selection or returns. `INCONCLUSIVE` includes rejected edits,
budget exhaustion, failed probes, and incomplete receipts. Every result remains `UNQUALIFIED`.

## Validation and rollout

The Python tests run the pinned upstream recursion engine with a deterministic research API boundary. They verify
probes, composition, library retention, original-registration recovery, ambiguity, budgets, and rejected edits.
They do not establish model quality or profitability.

```sh
uv venv --python 3.12 /tmp/bayn-harness2-venv
uv pip install --python /tmp/bayn-harness2-venv/bin/python -r services/bayn/harness2/requirements.txt
/tmp/bayn-harness2-venv/bin/python -m unittest discover -s services/bayn/harness2 -p 'test_*.py' -v
```

The Nix image pins upstream by commit and archive hash. Its runtime includes Python, Harness2, the S3 client, the
adapter, and the installed command. Image verification invokes `bayn-harness2 --help` with networking disabled.
The research worker receives its existing Restate origin and 256 MiB of bounded temporary artifact space.
No additional credentials, database grants, broker access, or network permissions are introduced.

Roll out through reviewed main, immutable image publication, `lab-delivery/bayn`, `kargo/bayn`, and Argo. Verify the
exact deployed image and source, run one explicitly labeled engineering study through the installed command, inspect
its native receipts and object-store artifacts, then repeat the completed study to verify no additional inference.
Engineering fixtures establish transport and lifecycle behavior only. Real research still requires eligible original
captures and independently verified semantic descriptions. Recovery stops research and preserves trading authority.

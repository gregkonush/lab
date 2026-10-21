# Harness2 and Jev design audit

Research date: 2026-10-20 America/Los_Angeles. Implementation inspected at
`fc73e8967522bf788b3539d4686d6237f5655a4b`; the earlier native integration is deployed from
`8bed05c8f6ca87e428522e76716e75e85cb40f5c`. This is a design assessment, not a real-market improvement result.

The current adapter is a native Jev instruction proposal and decision-comparison tool. It is not a completed
Bayn decision-improvement experiment. Its request reproduction and funded selection checks are useful, but its
comparison cannot establish economic improvement. Delivering another healthy image would not close that gap.
PR [#15233](https://github.com/proompteng/lab/pull/15233) is held in draft while the experiment is corrected.

The original research question remains: does a frozen Harness2-generated change improve Bayn's actual decisions,
after execution and operating costs, relative to the unchanged strategy and appropriate controls?

The primary sources distinguish several separate claims:

| Source                                                                                                                                                                                           | What it establishes                                                                                                                                                                                                                                                                                         | What it does not establish for Bayn                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [Harness2 paper, sections 2.2 and F](https://arxiv.org/html/2610.14224v1) and [pinned implementation](https://github.com/google-research/harness2/tree/1cfe254e8d25b15f37048c3730134686abe60335) | Frozen-model harness edits can be proposed, probed under matched conditions, and composed without ground-truth feedback. The paper evaluates code, web, office and legal tasks with separate benchmark grading. It warns that execution variability and model biases limit correctness and transfer claims. | Financial forecasting gains, Jev compatibility, suitability of Alpha-R1 as editor, or positive Bayn net performance. |
| [TypeSafe model customization](https://docs.typesafe.ai/models)                                                                                                                                  | Jev is customized through supplied state, instructions and criteria while its weights remain fixed.                                                                                                                                                                                                         | That a particular wording search discovers financial edge.                                                           |
| [TypeSafe Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13)                                                                                                              | Numeric precision, indirect questions, irrelevant state, inconsistent criteria and choice order require care. Arithmetic belongs in code.                                                                                                                                                                   | That Jev necessarily fails on Bayn; that requires a measured domain test.                                            |
| [TypeSafe AutoResearch cookbook](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery)                                                                                              | Proposed questions become supervised features, errors guide further search, and an untouched test measures the result. It recommends chronological/grouped splits and explicit metrics and stopping rules.                                                                                                  | That its wine-review result transfers to price forecasting, or that CatBoost must replace Bayn's current policy.     |
| [Alpha-R1 authors' model card](https://huggingface.co/FinStep/Alpha-R1/blob/main/README_en.md)                                                                                                   | The model is specialized for selecting Alpha101 factor identifiers using the `alpha_list` output contract.                                                                                                                                                                                                  | Reliable generation of Jev instruction documents or valid economic judgments about a new Bayn policy.                |
| [GEPA authors' implementation](https://github.com/gepa-ai/gepa)                                                                                                                                  | Text parameters can be searched against an explicit evaluator, with diagnostic feedback and separate development/validation data.                                                                                                                                                                           | That changing optimizer libraries fixes missing labels, sampling, execution assumptions or costs.                    |
| [Backtest-overfitting research](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) and [deflated Sharpe research](https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf)             | Search and selection can inflate reported performance; trial history and dependence matter.                                                                                                                                                                                                                 | A computed Bayn significance level, PBO or deflated Sharpe. None has been established here.                          |
| [Alpaca PAPER specification](https://docs.alpaca.markets/us/docs/paper-trading)                                                                                                                  | PAPER is a simulation and omits market impact, queue position and latency slippage, among other effects.                                                                                                                                                                                                    | Real executable capacity or live-capital profitability.                                                              |

The lack of labels inside Harness2 is deliberate. Calling that alone an implementation bug would misread the paper.
The missing component is Bayn's independent economic evaluation. A model can inspect whether an instruction produced
a different typed answer or corrected an observable procedural error. It cannot establish the profitability of an
unrealized market path by preferring the wording or plausibility of that answer. This is an inference about the
Bayn adaptation, not a claim made by the Harness2 authors.

The code has the following concrete gaps:

1. **No economic evaluator.** `compare_decisions` in `services/bayn/harness2/runner.py` compares funded selections,
   plans and rejection reasons. It never consumes subsequent market events, fills, fees, capital paths or operating
   expenses. Its economic result is always `UNPROVEN`. This is honest reporting, but does not deliver the requested
   experiment. The native client receipt also leaves Jev cost unallocated. Missing expenses cannot become zero.
2. **An unqualified editor choice.** `services/bayn/src/research-inference/contract.ts` pins Alpha-R1 as the editor.
   Its factor-screening specialization does not prove it cannot edit text, but the role needs its own qualification.
   `services/bayn-model/README.md` still requires the trained factor output format. The new editor's JSON instruction
   contract conflicts with that documented serving purpose. Availability of an existing endpoint was not evidence
   for choosing it. Do not carry this default into the corrected experiment without an editor task evaluation.
3. **A feasibility cohort presented too close to acceptance.** The private prepared manifest contains one development
   observation and eight validation observations from three crypto candidates. Validation spans
   `2026-10-20T23:49:26.724Z` through `23:58:44.004Z`, less than a single 15-minute holding horizon. The development
   embargo passes, but the validation observations overlap and come from the incumbent's recorded entry schedule.
   They cannot establish independent sessions, broad coverage, alternative portfolio paths or statistical power.
4. **Selection parity is narrower than execution parity.** `prepareJevHarnessProbe` now correctly uses the native batch
   builder, and `jevHarnessDecision` shares the funded selector. However, `harness2-command.ts` evaluates candidates
   sequentially in a newly registered research window. It does not replay the original live batch's timing,
   decision cutoff, order path or market arrivals. The receipt correctly says `OFFLINE_REEVALUATION`; a successful
   offline funded selection cannot establish that production could have executed it in time.
5. **No repeatability control.** Exact request hashes prove input identity. They do not prove deterministic provider
   answers. The current Jev request schema has no seed or temperature control, and one baseline/candidate pair cannot
   attribute a flip uniquely to wording. A bounded unchanged-prompt repeatability arm is needed for that inference.
   Choice-order robustness is a separate diagnostic; selecting whichever ordering makes more money would create
   another unrecorded search.
6. **The evolving portfolio is absent.** Reusing the incumbent's flat portfolio state for each observation can compare
   local selections. If one candidate enters earlier, its later cash, holdings, open orders, exits and feasible
   opportunities differ. Summing isolated opportunity labels would not measure either resulting strategy.
7. **Three strings define a narrow experiment.** Editing only entry, stop-loss and take-profit instructions is a valid
   restricted hypothesis class. It cannot fix missing state, answer-option coverage or contradictory criteria.
   Widen the editable contract only when a measured failure requires it; extra knobs are not an improvement metric.

Several engineering boundaries are correct and should be kept: source-controlled baseline instructions, pinned Jev
identity, native request construction and exclusions, immutable observations and choices, shared funded selection,
retained raw responses, explicit incomplete outcomes, bounded calls, private artifacts and no broker authority in
the research command. Their tests prove these boundaries. They do not prove a trading edge.

The repo already defines a stronger experiment in [the Jev incremental-value audit](jev-incremental-audit.md),
[matched-entry study](matched-entry-study.md), [native export contract](study-evidence-export.md),
[control portfolios](control-portfolios.md) and [net-edge research](net-edge-research.md). These documents are
navigation and contracts. Their synthetic tests and existing tools must not be represented as completed real-market
coverage. The new Harness2 runner does not currently consume their economic reports.

The corrected integration should keep Harness2 as the proposal mechanism and add an independent Bayn evaluator:

```mermaid
flowchart LR
  D[Frozen development observations] --> H[Harness2 proposes bounded Jev instructions]
  H --> J[Native Jev calls and retained responses]
  J --> B[Native Bayn decisions and causal execution lifecycle]
  B --> E[Development economic evaluator and controls]
  E --> F[Freeze selected candidate and all experiment settings]
  F --> T[Untouched later sessions]
  T --> V[Independent net-outcome verdict]
  V --> P[Reviewed adoption only if acceptance passes]
```

The evaluator owns financial correctness. Harness2's internal contrastive process can stay verifier-free; external
selection and acceptance can use recorded outcomes. Feeding economic labels back into an improver is also possible,
but that would be a supervised adaptation and must be described and separated from a faithful verifier-free
Harness2 run. Neither arrangement may expose final-test outcomes during proposal or selection.

The required evaluation contract is concrete:

- Freeze the economic estimand and admissible instruction changes. Measure candidate-minus-baseline session net
  performance at the same initial capital and existing risk limits, with drawdown, missingness and cost coverage
  reported separately. Keep a cash control. Use deterministic and delayed controls when estimating Jev's incremental
  selection value or the cost of model latency. A prompt comparison and an ablation of Jev itself answer different
  questions.
- Collect a schedule independent of either arm's holdings or selections. Retain every scheduled opportunity,
  candidate exclusion, abstention, failed call, timeout, zero-trade session and incomplete lifecycle. Verify source
  and controller coverage instead of reconstructing missing arrivals from later prices.
- Use native state at the original information cutoff. Keep exact arithmetic, feature calculations, fee break-even,
  sizing, eligibility and execution rules in code. Treat Jev's action probability as an unvalidated setup signal
  until it is evaluated against a defined outcome. Distribution concentration is not profit probability; see
  [TypeSafe confidence](https://docs.typesafe.ai/confidence).
- Replay each arm with its own cash, positions, orders, partial fills, protection plans, fees and deadlines. Include
  model and routing delays and verify subsequent executable quotes. Missing future data or residual positions make
  the result incomplete. Fixed-exit entry ablations and native model-selected-plan comparisons need distinct
  preregistered protocols because they measure different effects.
- Price all paid calls, including unsuccessful calls and abstentions, with effective-dated tariff and metering
  evidence. TypeSafe currently publishes a model tariff, but a published estimate is distinct from reconciled billing.
  Preserve unknown data, infrastructure and research allocations. Report PAPER and live capacity separately.
- Separate development search, candidate selection and final temporal acceptance. Block inference at the session
  level and embargo overlapping label horizons. Record all tried prompts, stopping rules, repeatability controls
  and selection decisions. Choose sample size from dependence, variability and a prespecified economic minimum;
  eight adjacent observations cannot substitute for that design.
- Freeze the candidate before the final test. Report a positive, negative or inconclusive result from measured
  outcomes and uncertainty. Refuse promotion when required coverage or costs are missing. A successful engine run
  and an unchanged decision remain useful diagnostics with narrower claims.

TypeSafe's supervised feature-discovery approach and GEPA are useful comparison designs. Replacing Harness2 with
another search library now would leave the same missing evaluator. First implement and verify the native economic
evaluation boundary. Then compare the unchanged prompt, a fixed deliberate edit and Harness2 proposals at equal
search budgets. Expand to alternative optimization methods only if that comparison justifies the added machinery.

No real model-backed Jev improvement study has completed for this integration. The prepared nine-observation sample
may be used for transport and decision-sensitivity checks, with its limitations explicit. It is rejected as an
improvement acceptance cohort. No generated instruction candidate has been adopted into live trading. The original
rollout goal remains unfinished until the corrected experiment and deployment evidence exist.

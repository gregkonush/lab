# Harness2 and Jev design audit

Initial research date: 2026-10-20 America/Los_Angeles. Primary sources rechecked on 2026-10-22.
Initial implementation inspected at
`fc73e8967522bf788b3539d4686d6237f5655a4b`; the earlier native integration is deployed from
`8bed05c8f6ca87e428522e76716e75e85cb40f5c`. This is a design assessment, not a real-market improvement result.

At the initial assessment, the adapter was a native Jev instruction proposal and decision-comparison tool.
Its request reproduction and funded selection checks did not establish economic improvement. Delivering another
healthy image would not close that gap. The October 22 follow-up completed a bounded existing-session comparison
using independently audited terminal execution evidence recovered after a report-finalization failure. That result
does not establish profitable trading or an optimizer ranking. Private execution artifacts remain outside this note.
PR [#15233](https://github.com/proompteng/lab/pull/15233) delivers research tooling; its review and deployment do not
establish economic acceptance of a generated candidate.

## Optimizer recommendation, rechecked October 22

**Choose GEPA's generic `optimize_anything` interface for the present typed-question editing task, using the
single `gepa` search engine and Bayn's native outcome evaluator.** Keep Jev as the typed System One model. This is
an engineering recommendation from the editable surface, evaluator contract, integration cost and available
controls. It is not a demonstrated Bayn performance ranking between optimizer algorithms.

For the larger objective of improving actual trading, the first experiment should measure Jev's incremental
value against cash and the existing numerical controls. A question search is justified only if the component adds
useful predictive information. The goal is higher execution value under the same risk limits after costs, not
more entries, a sharper option distribution or an editor's preferred explanation.

### What can be optimized

[TypeSafe's model contract](https://docs.typesafe.ai/models) keeps Jev weights fixed and exposes customization
through state, question instructions and criteria. Its [state contract](https://docs.typesafe.ai/concepts/state)
evaluates independent typed questions against supplied facts. Jev is not the generative model in this design.
A separate generative editor proposes serialized question definitions; the evaluator calls Jev's native typed API.
No OpenAI chat adapter should be placed in front of Jev or used to fabricate its answers.

Current Bayn source at `eee94a5509ba82d734c7fca333bc390b5339b66e` further restricts the experiment:

- `services/bayn/src/jev/trade-plan-choices.ts` asks a source-controlled setup `Choice` and a separate conditional
  complete-plan `Choice`. The setup question explicitly judges observed support rather than predicting a future
  price. Code constructs, prices and funds the available plans.
- `services/bayn/src/jev/decision.ts` requires supported setup and a valid funded plan. It ranks eligible symbols by
  the selected **setup** probability. The plan-probability observation in the earlier audit describes an older revision.
- `services/bayn/src/jev/instructions-contract.ts` exposes only one `entry` string to the editor. Changing this text
  cannot change signal fields, the setup question, plan coverage, quantities, fees, risk or authority.
- TypeSafe's [Jev 1.13 limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13) specifically favor direct
  semantic judgments and code-owned arithmetic. Its [confidence definition](https://docs.typesafe.ai/confidence)
  describes a statistic of the option distribution, not financial expected value.

The economic target must therefore be independently defined. A judgment that a current pattern is supported is not
an already calibrated probability of a profitable round trip. A downstream model predicting a financial event
from that judgment is learning a new target, not correcting an error in the original semantic question.

### Reviewed alternatives

The table distinguishes documented capabilities from the Bayn-specific recommendation. Author-reported code,
science, classification and wine-review benchmarks are not trading benchmarks.

| Tool or method                                                                                               | Primary-source capability                                                                                                                                          | Decision for this job                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [GEPA `optimize_anything`](https://gepa-ai.github.io/gepa/api/optimize_anything/optimize_anything/)          | Evolves a text artifact against an external numeric score and diagnostic feedback; examples can be opaque objects.                                                 | Best interface fit for the existing one-document intervention. Invoke Bayn's compiler and evaluator directly; the target need not be a generative LLM.                                                                                                                                           |
| [Harness2](https://arxiv.org/html/2610.14224v1)                                                              | Propose–Probe–Compose uses behavioral contrasts and model judgment without ground-truth supervision; the authors warn about variation, shared biases and transfer. | Keep as a proposal control in existing evidence. Do not use its preference as the primary financial selection criterion. Replacing that criterion would remove much of the reason to choose this framework.                                                                                      |
| [TypeSafe feature-discovery autoresearch](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) | An LLM proposes typed questions; Jev answers become numeric features; a supervised CatBoost model's errors guide revisions.                                        | Closest vendor-supported design for learning which Jev judgments help an outcome. A larger policy/feature research change than editing the current string. The cookbook's wine results and random folds do not validate market predictions.                                                      |
| [Optuna](https://optuna.readthedocs.io/en/stable/tutorial/20_recipes/002_multi_objective.html)               | TPE and other samplers search defined parameter spaces, with constrained and multiple-objective optimization.                                                      | Prefer for authorized numeric policy weights, thresholds or finite question catalogs. It does not propose arbitrary semantic revisions itself. Do not expose account-risk or capital authority as tunable parameters.                                                                            |
| [Ax / BoTorch](https://ax.dev/docs/tutorials/getting_started/)                                               | Stateful ask/tell experimentation for expensive and noisy black-box objectives, with parameters, constraints and outcome observations.                             | Strong alternative for a small structured numerical search with repeated measurements. It needs an encoding for arbitrary instruction text and adds experiment-state ownership already partly provided by Bayn.                                                                                  |
| [Nevergrad](https://facebookresearch.github.io/nevergrad/)                                                   | Derivative-free ask/tell optimization over mixed numerical and discrete spaces, including noise-aware optimizers.                                                  | Useful for a broader numerical policy search. Less direct than GEPA for an unrestricted question string; no source establishes that its numerical benchmarks transfer to this strategy.                                                                                                          |
| [DSPy MIPROv2](https://dspy.ai/3.1.0/learn/optimization/optimizers/)                                         | Searches instructions and demonstrations for DSPy predictors with Bayesian optimization.                                                                           | Valid explicit-metric alternative, but converting the existing typed API and native strategy into DSPy predictors brings additional adaptation with little benefit for one string.                                                                                                               |
| [TextGrad](https://github.com/zou-group/textgrad)                                                            | Uses LLM-produced textual feedback to optimize text variables through an autograd-like interface with customizable loss.                                           | Potentially adaptable; it does not provide true gradients through Jev or make an LLM financial critic reliable. More adapter work than the direct artifact/evaluator interface.                                                                                                                  |
| [OpenEvolve](https://github.com/algorithmicsuperintelligence/openevolve)                                     | Evolutionary program search, populations, checkpoints and cascaded evaluator metrics.                                                                              | Better matched when algorithm/code evolution is authorized. Its larger search machinery is unnecessary for the current bounded document. Its current default configuration includes evaluation retries and optional model feedback; Bayn would still need to own paid-call and metric authority. |
| [SkyDiscover AdaEvolve / EvoX](https://github.com/skydiscover-ai/skydiscover)                                | Adaptive program evolution and adaptive search-strategy evolution, with strong author-reported systems and algorithm benchmarks.                                   | Serious alternative for future program search. Those benchmark wins do not rank typed Jev question search. A wider editable program and larger search budget are not current requirements.                                                                                                       |
| Existing Bayn Ridge and matched-entry controls                                                               | Native numerical fit/scoring, execution-derived labels and matched timing controls already exist in this repository.                                               | Use as controls before adding a more expressive learner. They are research tools, not an established profitable live replacement. Their source-admission requirements must be satisfied.                                                                                                         |
| Jev fine-tuning, LoRA or policy-gradient training                                                            | The hosted TypeSafe API exposes no customer weight adaptation.                                                                                                     | Inapplicable to the current service contract. Training a separate downstream policy is possible; training Jev through this API is not.                                                                                                                                                           |

### API choice is not proof of the best search algorithm

The [July `optimize_anything` release](https://gepa-ai.github.io/gepa/blog/2026/07/22/optimize-anything-omni/)
separates the API from its engines: `gepa`, `autoresearch` and `meta_harness` share the same task/evaluator boundary.
Its own matched-budget Frontier-CS study reports that no single optimizer dominates. The combined `omni` system
wins that code benchmark, but that is not a reason to add several optimizers to Bayn's one-string experiment.
Start with one bounded engine and one evaluator. A future equal-budget comparison may reject that choice.

The [GEPA paper](https://arxiv.org/abs/2507.19457),
[generic optimization paper](https://arxiv.org/abs/2605.19633),
[AdaEvolve paper](https://arxiv.org/abs/2602.20133) and
[EvoX paper](https://arxiv.org/abs/2602.23413) evaluate different task populations. Their headline gains cannot be
combined into a universal leaderboard or a Bayn return estimate. Selecting the largest published improvement
would not answer this question.

Source inspection pinned GEPA to `8f287de942f41a6d1e0e7e5b2d576247c4bedee9`, OpenEvolve to
`515d1bcb7b36ac64bbe028f8d83b5d08315ca4b5`, and SkyDiscover to
`0d932b690670a7e544388ad362e9876c8bd256a0`. The reviewed Ax docs are 1.3.1 and Optuna docs 5.0.0.
These are research snapshots, not newly installed dependencies. GEPA's current source budget module limits
evaluator calls, not the number of Jev requests dispatched inside a full portfolio evaluation. Its documented
held-out test evaluation also occurs outside the search budget. Keep Bayn's total reservation, provider and expense
limits authoritative across proposal, validation, test and failure paths.

### Reuse the evidence and controls already present

The repository already contains:

- `services/bayn/src/intraday-replay/backtest.ts`: independently evolving native portfolios, simulated broker,
  real Jev calls, accounting and reconciliation.
- `services/bayn/src/jev/harness2-economics.ts`: identity, request/response, expense and ledger verification for
  native evidence. Its complete native comparison includes an unchanged-question repeat.
- `services/bayn/src/intraday-replay/matched-entry-command.test.ts` and `docs/bayn/matched-entry-study.md`:
  separate immediate numerical selection, that selection delayed to Jev's commitment, and Jev selection.
- `services/bayn/src/intraday-replay/six-bar-ridge-fit.ts` and `ridge-training.ts`: a small existing numerical
  control with disjoint training/evaluation and causal execution labels.

A practical limitation matters: the current Ridge training command requires original-capture provenance, a priced
data allocation and separate training/evaluation sessions. The REST reconstruction used for the bounded
one-session question comparison does not meet that contract. Do not relabel REST history as original capture,
replace unknown costs with zero or weaken those checks to claim an available trained model. A one-session
engineering comparison remains valid at its declared narrower scope; a new within-session training protocol would
be a separate explicit design.

Retained Jev answers can support numerical-policy experiments when every input and decision opportunity matches.
They cannot be transplanted to states produced by another holding, cash, plan menu or decision time. Cache exact
serialized request identities, not just symbol/minute. Do not sample only the incumbent's flat periods or completed
profitable trades; the existing incremental-value audit explains that selection bias. A normalizer and model
trained on all rows before a chronological split still leak future information.

### Recommended objective and experiment

The recommended goal is to establish whether Jev contributes execution value above cash and numerical controls,
under fixed capital and risk, then improve only the component that demonstrates value.

1. Freeze the economic event and execution policy. Code owns entry/exit prices, fees, quantities, risk and actual
   lifecycle labels. Keep unfilled, partial, expired, rejected, unavailable and abstaining cases in the evidence.
2. Compare the unchanged strategy and a frozen intervention on existing data. Use independently evolving portfolios
   for portfolio P&L, with exact accounting and known inference costs. Distinguish selection improvement from delay
   cost with the existing matched timing controls. Cash is a required economic reference; a smaller loss is not
   positive alpha.
3. For the present text intervention, let GEPA propose only schema-valid question documents. Return explicit
   native outcomes and diagnostics. Failed accounting, unknown mutations, unvalued held inventory and missing
   costs stay explicit rather than becoming invented fitness. No optimizer output grants trading authority.
4. If Jev contributes useful information, fit a small downstream outcome model before expanding it. The TypeSafe
   feature-discovery pattern can propose additional atomic judgments; compare numerical-only and numerical-plus-Jev
   models. Start with the existing simple control; CatBoost is an option, not a required new dependency.
5. Split development and later evaluation by time and overlapping label horizon. One existing session is enough
   for a bounded diagnostic; no twenty-new-session collection requirement follows. Data already inspected for
   candidate selection is development evidence, even when a library names it `test_set`.

Use independently measured held-out execution returns, not an arbitrary product of Jev probabilities.
[Calibration guidance](https://scikit-learn.org/stable/modules/calibration.html) distinguishes probabilistic quality
from calibration alone. A defined event and out-of-time labels are necessary; high win rate still does not measure
profit magnitude. TypeSafe's [composite scoring example](https://docs.typesafe.ai/patterns/composite-scoring) shows
code-owned combinations, not a proof that hand-chosen weights predict market returns.

The [time-series split guidance](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html)
explains future-to-past leakage and gap handling. Irregular market events require grouping by actual time and label
intervals, not merely dropping a fixed count of rows. The
[backtest-overfitting paper](https://www.davidhbailey.com/dhbpapers/backtest-prob.pdf) explains why repeated selection
inflates historical results. Retain every trial and failed screen. The separate prospective adoption protocol does
not block shipping an evaluator or reporting a bounded negative result.

### Evidence limits and decision

The investigation used current repository source and tests, native provider and serving receipts, the retained
historical source catalog, existing-session execution/accounting evidence, deployed revision readback, TypeSafe
contracts, primary optimizer code/docs and the cited research papers. Private execution data stays in private
operator evidence; public benchmark claims remain attributed to their authors. No optimizer head-to-head Bayn
benchmark was performed, no numeric-only control was silently added to the completed question experiment, and no
new backend or production policy was installed for this assessment.

**Decision:** choose the generic GEPA artifact/evaluator interface for the next authorized question-search
experiment. Reuse Bayn's native engine and receipts, retain one active optimizer implementation, and establish
incremental value over the existing controls before expanding to learned features or policy search. Harness2 is
compatible as a bounded proposer, but its verifier-free preference is a weaker fit to this financial objective.

## Earlier implementation findings

The follow-up source now replaces the active Alpha-R1 policy with a pinned general instruction editor, supplies a
research-only compiler for the native portfolio executable, binds its instruction hash and provider-call budget,
and reads native economic reports. These implementation changes addressed parts of the gaps below. At that
follow-up revision, full orchestration, real editor qualification, independent market coverage and a completed
economic experiment remained unverified. These paragraphs retain the earlier assessment rather than describing
the October 22 deployment and bounded comparison.
Main subsequently adopted complete funded trade-plan choices in
[PR #15230](https://github.com/proompteng/lab/pull/15230). The adapter and compiler now expose only that plan question's
single `entry` instruction and reject the retired separate stop-loss and take-profit strings. The findings below
describe the initially inspected implementation unless an update is stated.

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

There is a more fundamental fit question. Harness2 improves the execution process surrounding an agent: it can
repair omitted verification, poor tool use or an inadequate work plan by inspecting reruns of the same task.
Jev is a typed System One decision component. It selects supplied answers from application state; it is
[not trained to generate text](https://docs.typesafe.ai/model-jaggedness/jev-1.13#generation). Bayn already owns
its tools, arithmetic and execution process in code. Consequently, the useful editable surface here is narrower
than the agent harness in the paper. An editor may improve literal question wording or remove contradictions;
that does not supply missing information about future prices. Whether these changes improve financial prediction
is a separate empirical hypothesis. The paper's task scores do not establish that hypothesis.

The three questions at the initially inspected revision measured different things: an entry action, a thesis-invalidating observed stop
price, and an observed take-profit price supported by the supplied evidence. All are decisions under uncertainty.
Neither syntactic validity nor agreement between an editor and Jev establishes their future correctness.
The evaluator must distinguish question interpretation defects from a lack of predictive signal. If a numerical
or deterministic control matches Jev after costs, prompt search may be optimizing a component with no demonstrated
incremental value. That is a valid negative result and must remain an admissible end to the experiment.

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
8. **Full candidate replay needs an owning implementation.** `prepareBacktest` in
   `services/bayn/src/intraday-replay/backtest.ts` binds the unchanged compiled strategy, while its request builders
   and receipt decoders reconstruct compiled instructions. Its input has no candidate-instruction field. Rewriting
   a request in an HTTP wrapper would break sealed request identity and would not update the strategy's validation
   path. A candidate must be constructed and verified consistently throughout a research-only native execution,
   with its executable and instruction bytes retained. A reader for economic reports does not supply that producer.

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
When development outcomes are available, an explicit-metric optimizer is a more direct match to the financial
objective than judging behavioral contrast alone. That is an architectural inference, not a measured victory for
GEPA or the TypeSafe cookbook. Keep Harness2's proposal mechanism as one testable candidate; require evidence for
the extra search cost before expanding recursion or the experience library.

The existing [frozen Jev acceptance protocol](jev-migration-acceptance-v2.json) and its
`services/bayn/src/jev/acceptance.ts` implementation already define a separate numerical qualification question,
including matched controls, execution stress and attempt-indexed comparison error. A narrow prompt comparison
must not silently replace those controls or introduce a competing statistical pass rule. In particular, generating
many resamples of a handful of sessions does not create more independent market evidence. Bootstrap validity
depends on the dependence model and sample assumptions; see the
[original stationary-bootstrap research](https://doi.org/10.1080/01621459.1994.10476870). A session-delta report
can be useful descriptive evidence while the adequacy and qualification of the experiment remain unresolved.

No real model-backed Jev improvement study has completed for this integration. The prepared nine-observation sample
may be used for transport and decision-sensitivity checks, with its limitations explicit. It is rejected as an
improvement acceptance cohort. No generated instruction candidate has been adopted into live trading. The original
rollout goal remains unfinished until the corrected experiment and deployment evidence exist.

## Follow-up assessment on 2026-10-21

The follow-up source inspected at `4c2c322f26b7df870d62185654f63c0f20dd0fc4` has a native variant compiler,
portfolio replay output, normalized input identity, mandatory executable digests, an unchanged-prompt repeat and
explicit unknown data expenses. Those changes address the corresponding producer, identity and accounting gaps
above. They do not establish a completed experiment. `run_study` still ends at decision comparison, while the
economic command consumes reports produced separately. A completed proposal run cannot be called a completed
portfolio experiment.

Two additional defects were reproduced and corrected during this assessment. Native probe receipts now use
`bayn.jev-harness2-receipt.v2` and retain the original batch's excluded symbols, reasons and messages. Verification
reconstructs that exclusion list, and the editor sees it even when no candidate received inference. The economic
comparison now rejects a candidate whose instructions or executable match the baseline. An unchanged proposal is
a valid no-change research outcome; it cannot become a distinct candidate gain through provider variability.
These corrections do not establish financial improvement.

The [community Jev integration](https://github.com/SASUKE40/harness2/tree/993c5337b889a6f8f3585fdb57043ca7bc9dade9)
provides relevant evidence of technical feasibility. Its
[selector](https://github.com/SASUKE40/harness2/blob/993c5337b889a6f8f3585fdb57043ca7bc9dade9/harness2/core/jev.py)
asks typed questions about completed artifacts. Its
[vision executor](https://github.com/SASUKE40/harness2/blob/993c5337b889a6f8f3585fdb57043ca7bc9dade9/harness2/vision.py)
changes the rules, class descriptions and question decomposition supplied to Jev. Jev still returns typed answers.
The [demo's proposer](https://github.com/SASUKE40/harness2/blob/993c5337b889a6f8f3585fdb57043ca7bc9dade9/harness2/image_demo.py)
is scripted around a predefined catalog of fixes. The default selector substitutes offline answers; live Jev and
the image executor require explicit settings. This code was inspected, not executed in this audit. It supports
compatibility, not an independently replicated gain, an identification with another author's social-media demo,
or transfer from image labels to Bayn's financial objective.

There are three distinct questions for Bayn. Instruction fidelity asks whether Jev interprets the intended setup
from supplied state and choices. Selection value asks whether those judgments predict an observable future outcome
better than a fixed control. Portfolio value asks whether the resulting cash, positions and executions improve net
performance. Harness2 can propose an intervention in the first question. The second and third need independent
outcome evidence. Choice confidence alone cannot answer them; its definition is a property of the returned option
distribution, as documented by [TypeSafe](https://docs.typesafe.ai/confidence).

Editing one `entry` string is a valid restricted experiment. It cannot repair missing information, inadequate
candidate-plan coverage, contradictory criteria or a miscalibrated downstream policy. Bayn computes prices,
break-even costs and funding in code, which follows
[TypeSafe's numeric guidance](https://docs.typesafe.ai/model-jaggedness/jev-1.13). Whether the remaining setup
judgment has predictive value must be measured. The general instruction editor fits the text-generation role;
its model card does not qualify it as a Bayn editor or as an economic judge.

One concrete policy assumption needs its own test. `selectJevEntryCandidates` ranks symbols by the returned
probability of the selected complete plan. `jevTradePlanQuestion` can supply different plan menus for different
symbols. A [Choice distribution](https://docs.typesafe.ai/primitives/choice) is over the supplied options; that
ranking has not thereby become a common expected-net-profit scale across symbols. Prompt edits can change its
concentration without adding predictive information. Preserve the ranking for the prompt comparison so the
intervention remains identifiable. Use the separate deterministic and Jev-removed controls to test whether the
underlying decision policy contributes value. This observation alone does not justify changing production ranking.

For the financial objective, an explicit-metric search is the more direct design once a valid development evaluator
exists. Both [GEPA's evaluator interface](https://github.com/gepa-ai/gepa#optimize_anything-beyond-prompts) and
[TypeSafe's feature-discovery loop](https://docs.typesafe.ai/cookbooks/autoresearch_feature_discovery) illustrate that
arrangement. This is a design judgment, not a measured comparison between optimizers. Keep Harness2 as one bounded
proposal method and compare it with the unchanged prompt and a fixed deliberate edit under equal budgets. Keep
all trials, failures and zero-trade sessions. Freeze the chosen candidate before later evaluation, preserve the
existing prospective acceptance protocol and withhold a net verdict when required costs or market coverage are
missing. Changing the search library cannot supply that evidence.

The editor-context review found that `plan_*` labels lacked the supplied alternatives' stop, target, estimated loss
and estimated profit terms. The bounded trajectory now retains every complete-plan alternative and all signal
groups. Repeated immutable facts share references inside editor prompts; archived trajectories remain complete.
A pinned Qwen tokenizer check over 19 candidates and 16 plans measured 22,304 input tokens at the largest tested
reflection prompt. Adding the 4,096-token response allowance requires the revised 32,768-token context. The GPU
fraction remains 0.24. This synthetic capacity check does not prove deployed startup, latency or output quality.

The economic consumer also requires the frozen candidate's compiler `build.json`, with its exact file digest and
canonical receipt hash. It checks the executable, instruction, clean-source declaration, compiler version, source,
base image and strategy identities, then binds the receipt into the terminal comparison. A regression test shows
that the previous consumer accepted a changed candidate with no build receipt. These checks establish consistency
with the producer artifact. They do not authenticate an unsigned producer or replace independent source and binary
verification.

The final review also found that a clean Git checkout could contain modified ignored dependencies. The Nix image
now records the bundled dependency bytes and package metadata. The variant compiler verifies every byte passed to
Bun against that image receipt and rejects a changed import graph; the economic registration binds the same receipt.
Native evaluation must execute inside the exact verified base image so external runtime adapters use its pinned
closure. These checks still require trusted image provenance and do not authenticate an arbitrary unsigned producer.

Model replacement retires other real checkpoint-revision directories before download. The dedicated deployment's
`Recreate` strategy stops the old server before its init process touches the cache. Runtime caches are preserved,
checkpoint symlinks fail, and missing payload bytes plus 2 GiB headroom must fit before any network fetch. Regression
tests cover retirement ordering, symlink refusal and low-space failure. Rollback re-downloads the former locked model.

# Momentum-first Jev candidate

Status: source-selected PAPER research policy, paired to an explicitly approved sandbox mandate with a $1,000,000
daily gross-turnover budget. Source selection and mechanical readiness do not establish economic qualification.
The retained control has not established positive net economics.

## Exact entry policy

`bayn.positive-relative-observed-momentum-entry.v1` admits a flat-portfolio candidate only when its verified current midpoint
is strictly above the first actual reference minute common to the candidate and benchmark, and its exact return
minus the benchmark's exact return is strictly positive. Comparisons
use integer price micros and exact rational arithmetic; rounded displayed basis points never decide admission. A positive
stock return can qualify while SPY is declining. There is no restored 15 bp absolute threshold, 10 bp excess threshold,
breakout threshold, range-location threshold, new technical indicator, or calibrated profit claim.

For crypto, the candidate endpoint is its fresh executable midpoint; the benchmark endpoint is its last completed
bar close. Both returns use the first actual minute present in both histories. The immutable query explicitly
declares required benchmark symbols, including those that are also candidates. Missing required benchmark bars
or native features make the complete query unavailable before inference. Candidate trade/quote exclusions cannot
downgrade that requirement. A missing ETH print can exclude ETH as a candidate while BTC still uses valid ETH bars.
Equities retain the existing executable SPY benchmark contract.

Existing source identity, latest completed minute, freshness, two-sided displayed-size and market-specific entry-spread checks remain.
The entry spread ceiling is 5 bp for equities and 25 bp for crypto. The complete recorded candidate universe survives as requested candidates or explicit exclusions. Missing,
future, malformed or stale evidence cannot become a valid non-signal. If every candidate is positively verified but
fails an entry gate, the batch makes zero model calls and produces zero targets. A fully non-requested batch containing
unknown source candidates remains unusable.

Jev receives only admitted signals. It selects the setup through its `enter`/`wait`/`avoid` question. A valid chosen `enter`
action selects a funded target without a second model economics judgment or an additional probability floor. `wait` and `avoid` never authorize entry. Among chosen
enter actions, selection retains descending Jev enter probability, then symbol for ties. The action distribution
is not a calibrated probability of net profit.
This is a momentum eligibility gate before Jev, not a new momentum-ranked portfolio. Choosing the highest exact
relative-return candidate among accepted signals is a separate research hypothesis: it changed 5 of 26 selections in
an exposed retained-state projection. Gate-only admitted all 26 old projected selections, but that does not establish
unchanged future decisions, timing, orders, fills, or P&L.

Sizing remains one position and the existing 0.2 gross/symbol target weight, subject to all lower execution/account
limits. Jev cannot create an ineligible signal or override risk. Management retains the current held-position Jev
hold/exit evaluation, threshold, 50 bp protective stop, 15-minute maximum hold, and session-close liquidation. Entry
momentum and spread filters never suppress required management or protective exits. Management also receives booked entry fees, estimated exit fees and net liquidation P&L. Sunk entry fees
never justify postponing a protective exit.

## Bounded runtime and immutable evidence

- The only active protocol is `bayn.jev.protocol.v11`, with `chosen-model-action` entry selection and
  `capital-weighted-session-limit` sizing. A valid chosen enter action selects a funded target; no second model economic judgment is required. Retired protocols and their numeric entry floor are rejected by the runtime
- The current behavior is `bayn.jev.focused-action.behavior.v1`. Protocol, behavior, observation, batch v4,
  cycle and authority identities bind this policy. Retained historical evidence cannot start new active cycles
- Trading-signal input v9 retains explicit fee break-even context and restores the setup question. Entry
  pricing retains its fresh-quote lifetime and must stay within the inference-bound price ceiling, in addition to
  final spread, displayed-size and risk checks. Migration 123 requires flat settled inventory before this cutover
- Keep one durable observation per completed signal minute/purpose/cycle, the existing minute-plus-two-second window,
  pending-batch recovery, ten-second original deadline, at most fifteen eligible concurrent requests, and no queued
  historical catch-up. Every requested result must finish validly before selection. No top-K cutoff is introduced
- Preserve polling budgets and protective/reconciliation checks. This candidate does not shorten controller or broker
  polling intervals, add model retries or add quote subscriptions. The paired sandbox mandate activates the separately
  approved $1,000,000 daily turnover limit; all other limits remain unchanged

The historical protocol-v6 workload projection retained 132 of 300 entry requests; 127 belonged to usable batches. These are
same-state workload counts, not a causal forecast of saved money or activity. Smaller batches can change execution
latency and later portfolio state. Count every attempted, rejected, failed and late call in evaluation costs.

## Review and bounded PAPER activation

Activation pairs `strategy.ts`, the compiled Nix strategy identities, runtime manifests and a newly sealed research
mandate. It does not add an environment toggle or generic strategy registry. The mandate retains the same sandbox
account, credentials, exposure/loss limits, protective exits and existing account/day turnover history.

Publish the v10 cutover in OBSERVE first. Restore PAPER only with a new same-account mandate bound to the verified
published v10 strategy and image after native cutover proof.

The existing backtest CLI remains bound to the active source protocol and therefore follows the selected v10 policy.
Tests exercise the native evaluator and PostgreSQL persistence directly. Migration 123 admits the v10 authority
identity after flat, settled, freshly reconciled cutover. Historical evidence and account/day turnover remain immutable. A new PAPER mandate must bind the published v10 image and strategy.

PAPER research activation requires an explicit immutable Research mandate, current build/strategy/account/risk bindings,
and fresh exact, flat sandbox reconciliation. It does not require a previously profitable result. Before making an
economic qualification claim:

1. Review the exact merged source and passing unit, type, lint, build, native persistence and CI evidence. Verify current
   decision replay and source, behavior, protocol and mandate hashes end to end. Drain/reconcile existing cycles through
   the established activation path; never rebind an existing grant to a changed selection policy
2. Freeze candidate, all mandatory controls, source, parameters, unchanged questions/input representation plus the
   admission policy, timing, costs, universe, execution assumptions and registered calendar before the first untouched open.
   Preserve the [frozen acceptance contract](jev-migration-acceptance-v2.json), including every failed attempt, the
   $100,000 PAPER allocation, its activity/risk criteria and all twenty consecutive prospective sessions. That frozen
   document retains its original $200,000 turnover ceiling. The newly authorized $1,000,000 research budget must be
   explicitly accounted for in any new registration; it cannot silently be reported as satisfying the old risk contract
3. Compare both delay-matched same-opportunity selection and native-clock independent-portfolio all-in results. Include
   submitted-but-unfilled attempts, partial fills, failed/late model charges, allocated data costs, adverse execution
   stress, full batch completion plus persistence/routing time and reconciled flat closes. Do not present retained-state
   call filtering as an untouched backtest or profitability result
4. Use the existing reviewed main/image/Kargo/GitOps/native activation path only after approval of that exact PAPER
   scope. Verify the running image, selected protocol and account mandate agree. Stop research admission on evidence,
   accounting, loss/drawdown or authority failure while preserving risk-reducing management. Do not tune during the
   registered window; a material revision needs another immutable attempt and untouched evaluation

No missing signal or unavailable evidence becomes an order to satisfy an activity target. Removing the numeric
entry floor changes the PAPER policy and requires a new prospective comparison; retained v5 outcomes do not
qualify v6. Any economic improvement remains an empirical question under the unchanged risk and cost limits.

# Jev-selected trade plans and broker protection

Jev selects a complete entry, stop loss and take profit before execution. Protocol v16 / signal state v15,
batch v6, entry/exit targets v5 and position-exit policy v4 replace the earlier executable contracts.
Broker protection, sizing, cost, account-risk and holding/session safeguards remain enforced.

## Model contract

Jev returns typed judgments over supplied state. One `action` Choice selects a complete funded plan, `wait` or `avoid`.
A plan option contains its stop, stop-limit, take-profit, immutable funded quantity ceiling and estimated net loss/profit.
The model judges support for the whole plan within the holding horizon. No independent protection answer can disagree
with an entry answer. No `enter` option exists without a complete funded plan. Management still asks whether to hold or exit.
See the [Choice contract](https://docs.typesafe.ai/primitives/choice) and
[System One programming model](https://docs.typesafe.ai/concepts/system-one).

Code builds at most sixteen plans from four representative stop levels and four target levels. The candidate menu combines
observed OHLC levels with explicit hypothetical price scenarios. Its scenario step is one quarter of the observed OHLC range,
with a minimum executable tick. Stop scenarios lie one, two, four and eight steps below the observed bid. Target scenarios
lie those steps above the modeled break-even exit bid. Deduplication, conservative instrument rounding and four evenly spaced
representatives bound each set. The model selects the actual plan; these construction rules never select a default exit.

Every option labels its terms `HYPOTHETICAL_ORDER_PRICES`. Proposed future levels are neither recorded market observations
nor forecasts. Observed bars, features, prices and source identities remain unchanged in model state. A fresh high can therefore
have candidate targets without inventing historical highs. Candidate coverage and predictive usefulness still need empirical
validation; a supplied candidate is not evidence that the market will reach it.

Code funds every complete plan before inference. Target proceeds must exceed acquisition cost after modeled entry and exit
fees and adverse execution allowances. Stop proceeds must be positive and below acquisition cost. If allocation or prices
cannot fund any plan, only abstention remains. The exact sealed request, response and deterministic reconstruction bind the
chosen plan. A missing, foreign, altered, stale or unsupported choice cannot authorize an order. Model abstention remains
explicit in `entryPlanRejections`, and public no-trade status distinguishes `JEV_MODEL_ABSTAINED` from
`JEV_NO_FUNDED_CANDIDATES` instead of describing an empty account as satisfied targets.

Quantity retains existing capital allocation and instrument precision. The funded quantity ceiling prevents a cheaper
refreshed ask from expanding it. Account loss, drawdown, turnover, notional, exposure, open-order, authority and reconciliation
limits remain enforced. The maximum holding/session deadlines and five-second protection cadence remain safeguards.
Model probabilities compare supplied alternatives; they are not calibrated probabilities of profitable trades.

## Venue behavior

| Inventory and session                                 | Native protection                                                           | Application responsibility                                                                         |
| ----------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Whole-share equity entry in regular hours             | Entry LIMIT/DAY bracket binds take-profit LIMIT and stop-limit before entry | Confirm parent and both children; cancel an incomplete parent before protecting residual inventory |
| Settled whole-share equity inventory in regular hours | OCO take-profit LIMIT and stop-limit at the original prices                 | Recover ambiguous submission, verify the group and liquidate only after cancellation settles       |
| Fractional equity inventory in regular hours          | Individual STOP_LIMIT/DAY                                                   | Target, holding/session deadlines, renewal or residual close                                       |
| Crypto inventory                                      | Individual STOP_LIMIT/GTC after confirmed inventory is available            | Target and holding deadlines; cancel-confirm-reconcile before a residual LIMIT/IOC close           |
| Equity extended hours                                 | Application triggers                                                        | Alpaca advanced orders cannot supply extended-hours protection                                     |

Alpaca activates bracket children only after the parent fully fills. A partial entry therefore has a protection gap
until the parent remainder is canceled and settled inventory can be protected. Crypto cannot pre-register an equity
bracket or OCO; its strategy plan is bound before entry, while the stop is submitted after reconciled inventory is
available. A venue rejection, unavailable evidence or outage can delay that submission. Protection is armed only
when accepted broker orders prove the intended prices and remaining quantity. These constraints follow Alpaca's
[order rules](https://docs.alpaca.markets/us/docs/orders-at-alpaca),
[order API](https://docs.alpaca.markets/us/reference/postorder),
[crypto order support](https://docs.alpaca.markets/us/docs/crypto-orders) and
[fractional trading rules](https://docs.alpaca.markets/us/docs/fractional-trading).

A stop-limit specifies a price floor, not a guaranteed execution. A gap can leave it unfilled. A rapidly moving market
can fill both group legs before cancellation takes effect. The account controller detects residual or negative
inventory through normal broker and accounting reconciliation. It does not assume that a cancel response makes an
order terminal. See [FINRA's explanation of stop-order risks](https://www.finra.org/investors/insights/stop-orders-factors-consider-during-volatile-markets).

## Durable execution

Native terms participate in the deterministic intent identity, submitted-body hash, SQL record, recovery matching and
risk evaluation. SQL verifies them against the immutable entry strategy document. Conditional sells use their sealed
trigger or target as the price reference; they remain quantity-bounded reducing orders subject to fresh final broker
authorization. Native group requests reserve their complete prospective order count. Equity protection also verifies
regular-session eligibility again at final transmission.

Nested Alpaca responses establish the generated child identities. Their account, parent, symbol, side, duration,
prices and quantities are checked against the original intent. Children and their fills enter the same reconciliation
and accounting path as ordinary orders. Partial take-profit fills reduce remaining stop coverage without repricing it.
Posted coin fees and accounted protective disposals remain distinct inventory facts. Once native protection fully
exits the account, settled protective intents, receipts and fresh exact flat reconciliation complete the cycle and
permit the next normal admission. Conditional price evidence hashes the sealed plan and current reconciliation;
it does not fabricate a current executable quote.

Before an application target, stop or deadline close, the controller cancels outstanding protective sells. A durable
per-order cancellation command records that decision before the broker call and latches the exit. Ambiguous responses
require a new reconciliation. Retrying cancellation addresses the same broker order. All protective sells must be
terminal, with fresh exact inventory and accounting, before a new close sells the residual. A filled parent does not
make its remaining children disappear. Unknown submissions are recovered by their original client identity.

## Hard cutover

Migration 133 requires flat, settled and fully accounted inventory with fresh exact reconciliation. It retains
immutable financial and model history, restricts new Jev authority to v16, and accepts only current batch and
native protection contracts for new writes. It retires prior PAPER authority through the established OBSERVE
recovery path. A new same-account mandate is bound to the verified published image before PAPER restoration.
No legacy strategy evaluator or geometric exit fallback remains executable. Replay checkpoint v10 rejects
pre-cutover checkpoints. Broker order, fill and accounting history are preserved.

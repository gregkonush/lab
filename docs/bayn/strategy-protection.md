# Jev-selected trade plans and broker protection

Jev chooses the entry action, stop loss and take profit before execution. Protocol v15 / signal state v14,
batch v5, entry/exit targets v4 and position-exit policy v3 replace the earlier executable contracts.
There is no positive-return or benchmark-outperformance admission gate, range extension target,
fixed percentage stop, five-percent stop-distance cap or 0.1-percent capital-risk sizing rule.

## Model contract

The current Jev API returns typed judgments and closed choices, not arbitrary generated numeric prices.
Each candidate request includes an `action` choice and independent `stop_loss` and `take_profit` choices.
Price choices come from the actual completed OHLC observations available in that candidate's verified snapshot,
rounded conservatively to the instrument's executable precision. They are not an extrapolated price grid.
Each price question includes `none`; when a role has no valid observed price, its question is absent and
entry cannot be funded. The entry action still reaches Jev. This limitation can leave a setup without a
profit choice beyond a fresh high; it must never be hidden by inventing a replacement target.
See the [Choice contract](https://docs.typesafe.ai/primitives/choice) and
[value extraction pattern](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook).

All three answers describe the same trade. Only a chosen `enter` with both selected prices can proceed.
Code checks that the stop is positive and below the current bid and entry ceiling, that the take profit is
above that ceiling, and that estimated target proceeds cover the modeled entry and exit costs. An unsupported,
missing, inverted or unfunded plan cannot create an order. Code never substitutes another stop or target.
The immutable request, raw response and selected prices reproduce the exact sealed entry plan.
The batch question identity binds each symbol's distinct choices; a different price menu changes its identity.

Quantity retains the existing capital allocation and instrument precision. Its immutable funded quantity ceiling
prevents a cheaper refreshed ask from expanding it. Account loss, drawdown, turnover, notional, exposure, open-order,
authority and reconciliation limits remain enforced. The existing maximum holding/session deadlines and five-second
protection cadence remain execution safeguards. They are distinct from the removed price-selection formula.
No model action overrides those safeguards or proves predictive edge. Model probabilities are not calibrated
probabilities of a profitable trade.

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

Migration 129 requires flat, settled and fully accounted inventory with fresh exact reconciliation. It retains
immutable financial and model history, restricts new Jev authority to v15, and accepts only current batch and
native protection contracts for new writes. It retires prior PAPER authority through the established OBSERVE
recovery path. A new same-account mandate is bound to the verified published image before PAPER restoration.
No legacy strategy evaluator or geometric exit fallback remains executable. Replay checkpoint v9 rejects
pre-cutover checkpoints. Broker order, fill and accounting history are preserved.

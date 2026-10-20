# Strategy-bound position protection

The active Jev v14 strategy commits one immutable exit plan before an entry can execute. Jev chooses an entry action;
it does not choose an exit after a position is open. The rule, prices, quantity ceiling, estimated costs and capital
risk budget are included in the strategy decision and its canonical identity.

## Rule and parameters

The continuation hypothesis uses the complete 15-minute completed-bar window immediately before entry. The stop is
one venue price increment below its lowest low. The target is the maximum permitted entry price plus the window's
high-low range, rounded upward to a valid venue price. The maximum entry price includes the existing quote-drift and
adverse-limit allowances. These levels remain absolute prices after fills and fee publication.

The strategy rejects incomplete windows, malformed/duplicate/future bars, invalid price ordering, unsupported
precision, an already-invalidated setup, a stop farther than 500 basis points from the entry ceiling, or a target
that cannot cover conservative execution costs. Incomplete candidate evidence excludes that candidate before a paid
Jev request. Malformed evidence remains a contract error. The source snapshot and sealed decision reproduce the plan.

Quantity is the smaller of the existing exposure allocation and the quantity whose modeled stop liquidation loss
fits 10 basis points of account equity. The estimate includes entry and exit fees, received crypto quantity,
adverse sell allowance and fee rounding. This preserves the previous modeled price-loss scale of 20% allocation
multiplied by a 0.5% price stop, while including estimated costs in the budget. It is not an optimized parameter.
Rounding the allocation weight upward to one part per million preserves the funded quantity; its separate immutable
quantity ceiling prevents that rounding from increasing the order.

The first actual entry fill starts the 15-minute maximum holding time. Partial entry fills, retries and restarts do
not restart it. The controller checks price protection at most five seconds apart, with an earlier wake for the
holding or session deadline. Existing account loss, drawdown, turnover, authority, reconciliation and final broker
checks continue to govern submission.

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

Migration 128 requires terminal intents and mutation cycles, flat broker and accounting inventory, settled orders,
complete receipts and fresh exact reconciliation. It preserves financial history, retires the prior executable
protocol and clamps old PAPER authority for normal OBSERVE recovery. New execution requires the v14 identity and the
existing capital-activation path. Image publication does not grant live capital authority.

## Parameter evidence

The rule is an explicit experimental continuation hypothesis. Neither a geometric range nor a selected Jev action
establishes a profitable strategy. Two target-anchor formulations were inspected during development; the implemented
one measures the completed range upward from the maximum entry price. No parameters were fitted to the results below.

The retained source contains 163,623 original one-minute crypto bars with SHA-256
`7770bec9ca5275081981e5274152a716267d31ecaf8fad92e0b2d1a8ee9ed8e0`.
`services/bayn/tools/exit-policy-validation.ts` verifies the original pages and runs the current strategy calculation
with an explicitly hypothetical $100,000 capital amount and bar-close planning reference. It uses the production fee
and risk calculation. This reference is not an executable quote or an observed account balance.

| Symbol  |   Bars | Missing pre-entry history | No funded plan | Target touched first | Stop touched first | Deadline | Missing held history |
| ------- | -----: | ------------------------: | -------------: | -------------------: | -----------------: | -------: | -------------------: |
| BTC/USD | 66,923 |                    13,392 |         50,905 |                   40 |                864 |    1,722 |                    0 |
| ETH/USD | 44,885 |                    30,935 |         10,912 |                   77 |              1,001 |    1,347 |                  613 |
| SOL/USD | 51,815 |                    34,325 |         11,468 |                  214 |              2,077 |    2,620 |                1,101 |

SOL also had nine adverse opening-price exclusions and one opening price already below its bound stop. Touches are
not fills. The screen has no contemporaneous arrival evidence, executable quotes, Jev selection or complete operating
costs. It is not a strategy backtest, an economic qualification, or evidence that the parameters are profitable.
Most observed windows cannot fund the target after estimated costs. The remaining unselected touch counts provide no
basis for claiming an edge. PAPER receipts, reconciliation, execution costs and a properly frozen prospective
strategy evaluation remain separate evidence requirements.

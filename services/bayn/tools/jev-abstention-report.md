# Sealed Jev abstention diagnostics

From `services/bayn`, run:

```sh
bun tools/jev-abstention-report.ts /private/path/decision.json
```

The input is an existing persisted PAPER decision document containing `bindings.cycleId`
and `strategyDecision`, the same envelope used by `verify-jev-plan.ts`. The tool reads
one local file and prints JSON. It makes no model, database, broker, or network calls.
Keep input and output private: output includes source identifiers and position-sized
hypothetical profit/loss estimates. Do not commit production evidence.

The current source must reproduce the decision, including its sealed requests and
model receipts, before diagnostics are emitted. Unsupported historical contracts or
tampered evidence fail rather than being silently reinterpreted. Protocol version
`bayn.jev.protocol.v17` is distinct from input state version
`bayn.jev-trading-signal-state.v16`; both appear in report v2.

Each requested candidate reports funded-plan count, minimum/maximum target rise from
the observed bid, minimum/maximum net reward/risk, per-plan estimated gains/losses,
holding horizon, existing entry economics and fees, bar/trade coverage, chosen setup and action,
the setup distribution and conditional plan-choice masses. A conditional plan is evaluated under an assumed supported
setup; the actual setup answer must also support entry. Excluded candidates retain their exclusion reason.
Missing model answers, unavailable latest-trade age, and empty plan ranges are null,
not zero. Reported masses remain unnormalized, preserving provider rounding.

Funding establishes accounting validity, not likely target attainment. Reward/risk
uses conservative target gain divided by conservative stop loss; it is not expected
value and excludes unmodeled operating costs. Choice mass is not a calibrated profit
probability. Summed plan mass can exceed the largest individual option without
changing the provider's argmax. This report never changes selection, fees, horizons,
authority, or admission guards, and does not supply a model rationale or prove edge.

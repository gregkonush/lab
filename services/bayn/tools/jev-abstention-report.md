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
`bayn.jev.protocol.v16` is distinct from input state version
`bayn.jev-trading-signal-state.v15`; both appear in the report.

Each requested candidate reports funded-plan count, minimum/maximum target rise from
the observed bid, minimum/maximum net reward/risk, per-plan estimated gains/losses,
holding horizon, existing entry economics and fees, bar/trade coverage, chosen action,
and categorical choice masses. Excluded candidates retain their exclusion reason.
Missing model answers, unavailable latest-trade age, and empty plan ranges are null,
not zero. Reported masses remain unnormalized, preserving provider rounding.

Funding establishes accounting validity, not likely target attainment. Reward/risk
uses conservative target gain divided by conservative stop loss; it is not expected
value and excludes unmodeled operating costs. Choice mass is not a calibrated profit
probability. Summed plan mass can exceed the largest individual option without
changing the provider's argmax. This report never changes selection, fees, horizons,
authority, or admission guards, and does not supply a model rationale or prove edge.

## Exact-plan quote paths

```sh
bun tools/jev-abstention-report.ts /private/decision.json /private/assumptions.json /private/native-bundle.json
```

The optional two-file extension invokes `auditNativeArrivalCoverage` directly on
the original bundle bytes. It does not trust a supplied audit report, quote array,
or completeness flag. Bundle bytes must match the manifest SHA256; the validated
consumer epoch must match the sealed snapshot, the audited interval must exactly
match the declared window, and in-window projection sequences must follow the
sealed snapshot cut. Unknown assumption fields and foreign evidence fail closed.
See `native-arrival-coverage.md` for the private bundle format and bounded capture
validation. Its controller and commit-acknowledgement unknowns are retained in the
output. This is a repository-checkout tool, not a deployed trading command.

The research-only `reportJevPlanPath` function reproduces the sealed decision and
describes original quote deliveries against one explicitly declared funded plan.
It does not replace the original model choice. The assumption manifest binds the
decision hash and source-bundle SHA256, plan choice, quantity, instrument rules,
entry latency, fee stress, and observation or hypothetical first-fill clock.
Quantities must fit the sealed funded maximum and declared instrument increments.
Instrument rules are declared assumptions, not independently verified broker terms.
Fee multipliers below the existing fee basis are rejected. The multiplier is only
a declared research assumption: no fees or cash flows are calculated or applied.

An observation-anchored window is not an actual holding period. A hypothetical
first-fill anchor must follow declared entry arrival and precede request expiry;
it remains an assumption, not proof of an executable entry. Native holding time
starts at actual first fill. Original quote delivery order is preserved, including
same-millisecond sequence ordering. Quote freshness uses the sealed protocol and
the existing native replay validity predicate. Targets use the exact plan limit;
stops use the existing protective-stop predicate. The tool never substitutes the
mechanical control's fixed target/stop distances.

Every path is permanently `INCOMPLETE` and `UNQUALIFIED`, with null economic P&L.
The report includes first observed threshold crossings, quote rejection counts,
and leading, internal, and trailing delivery gaps. These are observations, not
fills, a target-before-stop execution outcome, or a win rate. Missing quotes do
not become zero returns. GTC order/controller parity, entry capacity and partial
fills, actual first-fill timing, full capture/controller completeness, and
operating-cost allocation are not established by quote crossings. Neither a
STOPPED capture nor matching durable counts proves controller completion.

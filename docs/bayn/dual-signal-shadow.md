# OHLCV and image shadow decisions

The opt-in `bayn-dual-signal` CLI compares two concurrent decisions over **identical source market data**. It never
changes Jev production decisions, position sizing, broker mutations, account grants, strategy hashes or risk limits.

1. Input is a private, hashed `bayn.jev-evaluation-request.v1` evidence artifact, validated before dispatch.
2. Jev 1.13.0 evaluates the original numerical request, containing candidate OHLCV, benchmark and trade economics.
3. A deterministic 640×360 PNG is rendered solely from the candidate one-minute OHLCV bars, then GPT-6 Luna
   classifies `upward`, `unclear`, or `adverse` using OpenAI `POST /v1/decisions`.
4. Separate responses, types, probability distributions, latency, provider token usage, estimated token costs and
   hashes are recorded in a new **private** report, with explicit partial failures. Both calls have bounded deadlines.

The chart does **not** provide independent market evidence. The report explicitly records
`independentEvidence: false` and `tradingAuthority: NONE`. Agreement cannot count as two independent confirmations.
Enabling this for trades would require a separate walk-forward net-P&L, latency, calibration, drawdown and expense
validation, with a reviewed change to trading authority and deterministic decision evidence.

## Invocation

The CLI ships in the standard Bayn image, but the trading runtime does not invoke it automatically. When an
approved research environment has provider credentials and outbound access:

```sh
# Load these values from your private secret manager, never commit them.
# BAYN_JEV_API_KEY
# BAYN_OPENAI_API_KEY
# BAYN_PUBLIC_INFORMATION_PROXY
bayn-dual-signal --request /private/jev-evaluation-request.json --output /private/dual-signal-report.json
```

It rejects an existing report path, uses file mode `0600`, prints only status/hash metadata, and fails rather than
treating absent metering as free usage. The output estimates pico-USD from October 22, 2026 list assumptions:
Jev $0.042/1M input, OpenAI $0.10/1M ordinary input, $0.01/1M cached reads, $0.125/1M default 30-minute cache
writes, with no charged output. These are **not invoice-reconciled costs** and do not post to TigerBeetle.

## Security/rollout gate

The existing Bayn proxy allowlist does not include `api.openai.com`, and no OpenAI credential is configured on
the research workload. Deploying the binary alone therefore **does not launch live visual calls**. Separate
authorization to add a sealed OpenAI API key and its approved egress destination is needed before a production
shadow trial. Do not add those permissions or enable autonomous spending as an incidental code rollout.

# Miel Service

A Go service that integrates with the Alpaca Trading API to backtest simple trading strategies and place real or paper-market orders. The service exposes an HTTP API for:

- Triggering historical simulations (`POST /api/v1/backtests`) using Alpaca market data
- Submitting market orders to Alpaca (`POST /api/v1/orders/market`)
- Health checking (`GET /healthz`)

## Project Layout

```
services/miel/
├── internal/
│   ├── alpaca/     # Lightweight wrappers around Alpaca trading and market data clients
│   ├── backtest/   # Strategy engine and backtest result types
│   ├── config/     # Environment variable driven configuration loader
│   ├── server/     # Gin HTTP server wiring and handlers
│   └── trading/    # Trading service with input validation helpers
├── main.go         # Service entrypoint and HTTP server bootstrap
├── go.mod / go.sum # Module definition and dependencies
└── README.md       # This file
```

## Configuration

Set the following environment variables before running the service. Paper-trading endpoints are used by default.

| Variable | Description | Default |
| --- | --- | --- |
| `HTTP_PORT` | HTTP listen port. Prefix with `:` if desired. | `8080` |
| `ALPACA_API_KEY` | Alpaca API key (paper or live). | _required_ |
| `ALPACA_SECRET_KEY` | Alpaca API secret. | _required_ |
| `ALPACA_BASE_URL` | Trading REST base URL. | `https://paper-api.alpaca.markets` |
| `ALPACA_DATA_BASE_URL` | Market data REST base URL. | `https://data.alpaca.markets` |
| `ALPACA_REQUEST_TIMEOUT_SECONDS` | Timeout applied to outbound Alpaca calls. | `30` |
| `BACKTEST_MAX_BARS` | Maximum bars fetched per backtest request. | `5000` |

## Developing Locally

```bash
# Install dependencies
pnpm install  # repo root

# Tidy the Go module
cd services/miel
go mod tidy

# Run tests
go test ./...

# Start the service (example env vars)
export ALPACA_API_KEY=... \
       ALPACA_SECRET_KEY=... \
       HTTP_PORT=8080

go run ./...
```

## HTTP API

### `POST /api/v1/backtests`

Request body:

```json
{
  "symbol": "AAPL",
  "timeframe": "1Day",
  "start": "2024-01-01T00:00:00Z",
  "end": "2024-02-01T00:00:00Z",
  "quantity": 10,
  "strategy": "sma-cross",
  "fast_period": 5,
  "slow_period": 20
}
```

Strategies:

- `buy-and-hold` (default)
- `sma-cross` (uses simple moving average crossover; configurable fast/slow periods)

### `POST /api/v1/orders/market`

Request body:

```json
{
  "symbol": "AAPL",
  "quantity": 1,
  "side": "buy",
  "time_in_force": "day",
  "extended_hours": false
}
```

Response mirrors Alpaca’s order payload.

## Deployment

- Build a container image from the service root (`services/miel`).
- Configure Kubernetes manifests (Deployment, Service, Secret) and register the application with Argo CD following the repository’s conventions.
- Inject environment-specific Alpaca credentials using Kubernetes Secrets (e.g. `ALPACA_API_KEY`, `ALPACA_SECRET_KEY`).

## Next Steps

- Extend the backtest engine with additional strategies (RSI, Bollinger Bands, etc.).
- Persist backtest runs (PostgreSQL or object storage) for later retrieval via the API.
- Export Prometheus metrics (latency, success/failure counts, strategy performance) for observability.
- Add validation of available buying power before placing live orders.

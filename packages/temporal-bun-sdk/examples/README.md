# Examples – `@proompteng/temporal-bun-sdk`

The demo checks that the Bun client can authenticate against either the local Temporal docker-compose stack or an existing cluster.

## Prerequisites
- Bun 1.1.20+
- `pnpm install` at the repo root
- Docker Desktop (only if you want the local Temporal stack)

## Local loop (`pnpm run demo`)
1. Copy environment defaults and adjust as needed:
   ```bash
   cp packages/temporal-bun-sdk/examples/.env.example .env.local
   ```
2. (Optional) boot the local Temporal stack:
   ```bash
   docker compose -f packages/temporal-bun-sdk/examples/docker-compose.yaml up --build
   ```
3. Run the connectivity check:
   ```bash
   pnpm run demo
   ```
   - Creates a Bun Temporal client using `loadTemporalConfig()`.
   - Reports whether the native bridge successfully established a connection.
   - Cleans up the client handle automatically; stop the Docker compose stack separately if you started it.

> **Note:** Worker execution is still under development for the Bun runtime. The demo focuses on validating client connectivity until the worker bridge lands.

## Connecting to Temporal Cloud
1. Copy the cloud template and fill in TLS/API key paths:
   ```bash
   cp packages/temporal-bun-sdk/examples/.env.cloud.example .env.local
   ```
2. Ensure the Bun process can read the certificates (consider mounting them in CI/CD).
3. Run `pnpm run demo` – the script detects TLS env vars and configures the client automatically.

## Troubleshooting
- Use `bun run packages/temporal-bun-sdk/tests/native.test.ts` if the native bridge fails to load; see [docs/troubleshooting.md](../docs/troubleshooting.md) for error-specific fixes.
- `TEMPORAL_ALLOW_INSECURE=true` helps when testing against self-signed certificates (never use in production).

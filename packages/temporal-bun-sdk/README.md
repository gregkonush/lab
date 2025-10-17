# `@proompteng/temporal-bun-sdk`

Temporal connectivity helpers for Bun—bundled with our pre-built Temporal bridge so teams can install, configure, and verify Temporal access without cloning upstream SDKs.

## Quickstart

1. **Install the package:**
   ```bash
   pnpm add @proompteng/temporal-bun-sdk
   ```
2. **Bootstrap environment variables:** copy `.env.local` from the examples guide and set namespace, task queue, and TLS/API key values if you connect to Temporal Cloud.
3. **Verify connectivity:** follow `packages/temporal-bun-sdk/examples/README.md` to run `pnpm run demo`, which loads `.env.local`, opens a Bun Temporal client handle, and reports success/failure.

When you are ready to embed the SDK in an existing service, see the [migration guide](./docs/migration-guide.md) for phase-by-phase commands.

## Usage

```ts
import { createTemporalClient, withTemporalClient } from '@proompteng/temporal-bun-sdk'

const { client } = await createTemporalClient()
console.log('Connected to Temporal at', client.config.address)
client.close()

await withTemporalClient(async (activeClient) => {
  console.log('Namespace resolved to', activeClient.config.namespace)
})
```

All helpers use `loadTemporalConfig()` under the hood, so environment variables drive both local development (`127.0.0.1:7233`) and Temporal Cloud connections. Worker execution is not yet available in the Bun runtime—track progress in `docs/troubleshooting.md`.

## Configuration Reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `TEMPORAL_ADDRESS` | `${TEMPORAL_HOST}:${TEMPORAL_GRPC_PORT}` | Set when you have a single endpoint (e.g. `foo.temporal.io:7233`). |
| `TEMPORAL_HOST` | `127.0.0.1` | Used to compose the address when `TEMPORAL_ADDRESS` is unset. |
| `TEMPORAL_GRPC_PORT` | `7233` | Temporal gRPC port. |
| `TEMPORAL_NAMESPACE` | `default` | Namespace used by clients and workers. |
| `TEMPORAL_TASK_QUEUE` | `prix` | Default worker task queue. |
| `TEMPORAL_API_KEY` | — | Injected into connection metadata (Temporal Cloud). |
| `TEMPORAL_TLS_CA_PATH` | — | Absolute path to the root CA bundle. |
| `TEMPORAL_TLS_CERT_PATH` / `TEMPORAL_TLS_KEY_PATH` | — | Client certificate pair for mTLS. |
| `TEMPORAL_TLS_SERVER_NAME` | — | Overrides TLS server name—required for Temporal Cloud regional endpoints. |
| `TEMPORAL_ALLOW_INSECURE` / `ALLOW_INSECURE_TLS` | `false` | Accepts `1/true/on` to skip certificate validation (local only). |
| `TEMPORAL_WORKER_IDENTITY_PREFIX` | `temporal-bun-worker` | Prepended to worker identities before host/PID suffixes. |

### Temporal Cloud example

```bash
cp packages/temporal-bun-sdk/examples/.env.cloud.example .env.local
echo 'TEMPORAL_ADDRESS=foo.a1c1.tmprl.cloud:7233' >> .env.local
echo 'TEMPORAL_NAMESPACE=proompteng.default' >> .env.local
echo 'TEMPORAL_API_KEY=tmprlsk_live_...' >> .env.local
echo 'TEMPORAL_TLS_CA_PATH=/etc/temporal/ca.pem' >> .env.local
echo 'TEMPORAL_TLS_CERT_PATH=/etc/temporal/client.pem' >> .env.local
echo 'TEMPORAL_TLS_KEY_PATH=/etc/temporal/client-key.pem' >> .env.local
```

The worker and client automatically load these secrets, enable TLS, and set `NODE_TLS_REJECT_UNAUTHORIZED=0` only when explicitly requested through the `TEMPORAL_ALLOW_INSECURE` flags.

## Development Workflow

- `pnpm --filter @proompteng/temporal-bun-sdk dev` — watch the worker entry point (currently emits a “not yet available” notice).
- `pnpm --filter @proompteng/temporal-bun-sdk build` — emit Bun/ESM artifacts to `dist/`.
- `pnpm --filter @proompteng/temporal-bun-sdk test` — run Bun unit tests.
- `pnpm run demo` from the repo root — verify the Bun client can connect using the active environment variables.

Packaging and release steps are documented in [docs/design-e2e.md](./docs/design-e2e.md#release-lifecycle) and validated via `pnpm pack --filter @proompteng/temporal-bun-sdk`.

## Additional Guides

- [End-to-end architecture](./docs/design-e2e.md)
- [Migration guide (Phase 0 → Phase 3)](./docs/migration-guide.md)
- [Example workflows walkthrough](./examples/README.md)
- [Troubleshooting & FAQ](./docs/troubleshooting.md)

These references ship with the npm package so developers can access them directly from npmjs.com or `node_modules`.

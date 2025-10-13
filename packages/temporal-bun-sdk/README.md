# `@proompteng/temporal-bun-sdk`

A Bun-first starter kit for running Temporal workers that mirrors our existing Go-based setup (namespace `default`, task queue `prix`, gRPC port `7233`) while providing typed helpers for connection, workflow, and activity registration.

## Features
- Zod-backed environment parsing (`loadTemporalConfig`) with sane defaults and TLS loading.
- Factories for Temporal connections, workflow clients, and workers.
- Example workflows/activities plus an executable `temporal-bun-worker` binary.
- Dockerfile and `docker-compose` example for containerized development.

## Installation

```bash
pnpm install
```

Build and test the package:

```bash
pnpm --filter @proompteng/temporal-bun-sdk build
pnpm --filter @proompteng/temporal-bun-sdk test
```

## Usage

```ts
import { createTemporalClient, loadTemporalConfig } from '@proompteng/temporal-bun-sdk'

const { client } = await createTemporalClient()
const workflow = await client.workflow.start('helloTemporal', {
  taskQueue: 'prix',
  args: ['Proompteng']
})
console.log('Workflow execution started', workflow.workflowId)
```

Start the bundled worker (after building):

```bash
pnpm --filter @proompteng/temporal-bun-sdk run start:worker
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TEMPORAL_ADDRESS` | `${TEMPORAL_HOST}:${TEMPORAL_GRPC_PORT}` | Direct address override (e.g. `temporal.example.com:7233`). |
| `TEMPORAL_HOST` | `127.0.0.1` | Hostname used when `TEMPORAL_ADDRESS` is unset. |
| `TEMPORAL_GRPC_PORT` | `7233` | Temporal gRPC port. |
| `TEMPORAL_NAMESPACE` | `default` | Namespace passed to the workflow client. |
| `TEMPORAL_TASK_QUEUE` | `prix` | Worker task queue. |
| `TEMPORAL_API_KEY` | _unset_ | Injected into connection metadata for Cloud/API auth. |
| `TEMPORAL_TLS_CA_PATH` | _unset_ | Path to trusted CA bundle. |
| `TEMPORAL_TLS_CERT_PATH` / `TEMPORAL_TLS_KEY_PATH` | _unset_ | Paths to mTLS client certificate & key (require both). |
| `TEMPORAL_TLS_SERVER_NAME` | _unset_ | Overrides TLS server name. |
| `TEMPORAL_ALLOW_INSECURE` / `ALLOW_INSECURE_TLS` | `false` | Accepts `1/true/on` to disable TLS verification (sets `NODE_TLS_REJECT_UNAUTHORIZED=0`). |
| `TEMPORAL_WORKER_IDENTITY_PREFIX` | `temporal-bun-worker` | Worker identity prefix (appends host + PID). |

These align with the existing Temporal setup (`services/prix/worker/main.go`, `packages/atelier/src/create-default-namespace.ts`) so Bun workers can drop into current environments without additional configuration.

## Docker

Build the worker image from the repo root:

```bash
docker build -f packages/temporal-bun-sdk/Dockerfile -t temporal-bun-sdk:dev .
```

Or spin up a full stack (Temporal + worker) via Compose:

```bash
docker compose -f packages/temporal-bun-sdk/examples/docker-compose.yaml up --build
```

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm --filter @proompteng/temporal-bun-sdk dev` | Watch `src/bin/start-worker.ts` with Bun. |
| `pnpm --filter @proompteng/temporal-bun-sdk build` | Type-check and emit to `dist/`. |
| `pnpm --filter @proompteng/temporal-bun-sdk test` | Run Bun tests under `tests/`. |
| `pnpm --filter @proompteng/temporal-bun-sdk run start:worker` | Launch the compiled worker. |


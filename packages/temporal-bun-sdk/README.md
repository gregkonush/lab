# `@proompteng/temporal-bun-sdk`

A Bun-first starter kit for running Temporal workers that mirrors our existing Go-based setup (namespace `default`, task queue `prix`, gRPC port `7233`) while providing typed helpers for connection, workflow, and activity registration.

## Features
- Zod-backed environment parsing (`loadTemporalConfig`) with sane defaults and TLS loading.
- Factories for Temporal connections, workflow clients, and workers.
- Example workflows/activities plus an executable `temporal-bun-worker` binary.
- Project scaffolding CLI (`temporal-bun init`) with Docker packaging helpers.
- Dockerfile and `docker-compose` example for containerized development.
- Detailed FFI implementation blueprint in [`docs/ffi-surface.md`](./docs/ffi-surface.md) to guide future native bridge work.
- Zig migration roadmap in [`docs/zig-bridge-migration-plan.md`](./docs/zig-bridge-migration-plan.md) covering the phased replacement of the Rust bridge.

## Documentation

- [`docs/design-e2e.md`](./docs/design-e2e.md) – product and architecture overview.
- [`docs/ffi-surface.md`](./docs/ffi-surface.md) – native bridge blueprint.
- [`docs/ts-core-bridge.md`](./docs/ts-core-bridge.md) – TypeScript core bridge implementation.
- [`docs/client-runtime.md`](./docs/client-runtime.md) – Bun Temporal client rewrite.
- [`docs/worker-runtime.md`](./docs/worker-runtime.md) – worker orchestration plan.
- [`docs/workflow-runtime.md`](./docs/workflow-runtime.md) – deterministic workflow runtime strategy.
- [`docs/payloads-codec.md`](./docs/payloads-codec.md) – payload encoding & data conversion.
- [`docs/testing-plan.md`](./docs/testing-plan.md) – validation matrix.
- [`docs/migration-phases.md`](./docs/migration-phases.md) – phased rollout checklist.

## Installation

```bash
pnpm install

# Clone upstream Temporal sources (one-time setup)
git clone --depth 1 --branch master https://github.com/temporalio/sdk-core.git ~/github.com/temporalio/sdk-core
git clone --depth 1 --branch main https://github.com/temporalio/sdk-typescript.git ~/github.com/temporalio/sdk-typescript

# Symlink the checkouts into this workspace (kept out of git)
mkdir -p packages/temporal-bun-sdk/vendor
ln -s ~/github.com/temporalio/sdk-core packages/temporal-bun-sdk/vendor/sdk-core
ln -s ~/github.com/temporalio/sdk-typescript packages/temporal-bun-sdk/vendor/sdk-typescript

# Compile the native Temporal bridge (requires protoc in PATH)
pnpm --filter @proompteng/temporal-bun-sdk run build:native
```

> **Tip:** For deterministic builds, pin the repositories to the versions we test against:
> ```bash
> git -C ~/github.com/temporalio/sdk-core checkout 9a54f72f  # example commit
> git -C ~/github.com/temporalio/sdk-typescript checkout v1.13.1
> ```

Ensure `protoc` ≥ 28 is installed (`brew install protobuf` on macOS, `apt install protobuf-compiler` on Debian/Ubuntu).

Build and test the package:

```bash
pnpm --filter @proompteng/temporal-bun-sdk build
pnpm --filter @proompteng/temporal-bun-sdk test
```

## Usage

```ts
import { createTemporalClient, loadTemporalConfig } from '@proompteng/temporal-bun-sdk'

const { client } = await createTemporalClient()
const workflow = await client.workflow.start({
  workflowId: 'helloTemporal-001',
  workflowType: 'helloTemporal',
  taskQueue: 'prix',
  args: ['Proompteng'],
})
console.log('Workflow execution started', workflow.runId)

> **Note:** The current Bun-native client supports workflow starts today. Signal, query, and termination APIs are under active development.
```

Start the bundled worker (after building):

```bash
pnpm --filter @proompteng/temporal-bun-sdk run start:worker
```

## CLI

The package ships a CLI for project scaffolding and container packaging.

```bash
temporal-bun init my-worker
cd my-worker
bun install
bun run dev          # runs the worker locally
bun run docker:build # builds Docker image via Bun script
```

Verify connectivity to your Temporal cluster using the Bun-native bridge:

```bash
temporal-bun check --namespace default
```

To build an image from the current directory without scaffolding:

```bash
temporal-bun docker-build --tag my-worker:latest
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
| `pnpm --filter @proompteng/temporal-bun-sdk run test:coverage` | Run tests with Bun coverage output under `.coverage/`. |
| `pnpm --filter @proompteng/temporal-bun-sdk run start:worker` | Launch the compiled worker. |
| `pnpm --filter @proompteng/temporal-bun-sdk run build:native` | Build the Bun ↔ Temporal native bridge. |

# Troubleshooting & FAQ – `@proompteng/temporal-bun-sdk`

This guide collects the most common snags when using the Bun-only Temporal SDK.

## Native bridge fails to load
- **Symptom:** `Temporal Bun bridge library not found ...` when running the demo or tests.
- **Fix:** Run `pnpm --filter @proompteng/temporal-bun-sdk run build:native` to compile the bridge. The artifacts land in `native/temporal-bun-bridge/target/release` during development and are copied to `dist/native` when publishing.
- **CI tip:** Cache `$CARGO_HOME/registry` and `native/temporal-bun-bridge/target` to avoid rebuilding the bridge on every run.

## `createTemporalClient` throws immediately
- **Symptom:** Demo exits with `failed to establish Temporal client`.
- Confirm the Temporal server is reachable (`telnet <host> <port>` or `nc -vz`).
- Check `.env.local` for typos—`TEMPORAL_ADDRESS` takes precedence over `TEMPORAL_HOST`/`TEMPORAL_GRPC_PORT`.
- If using Temporal Cloud, ensure the API key is valid and has namespace access; use `TEMPORAL_API_KEY=...`.
- Bun currently reuses Node's TLS store. When connecting to self-signed endpoints, set `TEMPORAL_ALLOW_INSECURE=1` or provide `TEMPORAL_TLS_CA_PATH`.

## TLS or mTLS setup
- CA, cert, and key paths must be readable by the Bun process.
- The SDK base64-encodes certificates before passing them to the native bridge; empty files will trigger `Invalid configuration` errors.
- `TEMPORAL_TLS_SERVER_NAME` should match the server certificate’s CN/SAN—Temporal Cloud requires the regional host.

## Running in CI
- Install Bun (`curl -fsSL https://bun.sh/install | bash`) before running `pnpm install`.
- Set `BUN_INSTALL` and add `$BUN_INSTALL/bin` to `PATH` for subsequent steps.
- Run `pnpm --filter @proompteng/temporal-bun-sdk run build && pnpm pack --filter @proompteng/temporal-bun-sdk` as part of release validation to ensure the tarball is self-contained.

## Where is the Bun worker?
- Worker execution is not yet available; `runWorker()` and the `temporal-bun-worker` CLI currently emit a “coming soon” message.
- Keep existing `@temporalio/worker` processes until the Bun bridge lands. Migration Phase 3 in the [migration guide](./migration-guide.md) explains the future swap.
- Track status in [docs/design-e2e.md](./design-e2e.md) and rerun `pnpm run demo` when worker support lands—the demo will expand to start workflows end to end.

## Need help beyond this?
- Run `rg '@temporalio/' docs packages/temporal-bun-sdk` to locate lingering upstream references during migration.
- File issues with the failing command output and OS/architecture details; include whether the native bridge was rebuilt or reused from `dist/native`.

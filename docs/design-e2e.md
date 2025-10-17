# `@proompteng/temporal-bun-sdk` – End-to-End Design

This mirrors `packages/temporal-bun-sdk/docs/design-e2e.md` for broader visibility. See that document for release engineering minutiae.

## Goals
- Bun-only Temporal SDK installable from npm without cloning upstream repositories.
- Support macOS/Linux (x64/arm64) across self-hosted Temporal and Temporal Cloud deployments.
- Keep quickstart, migration, and troubleshooting docs in the published package so teams browsing npm see authoritative guidance.

## Architecture Snapshot
```
┌──────────────────────────────────────┐
│ @proompteng/temporal-bun-sdk (npm)   │
│  ├─ dist/esm runtime + types         │
│  ├─ dist/native/libtemporal_*        │
│  ├─ docs/, examples/                 │
│  └─ bin/temporal-bun-worker (Bun stub) │
└───────────────┬──────────────────────┘
                │ Bun FFI
                ▼
┌──────────────────────────────────────┐
│ temporal-sdk-core-c-bridge (prebuilt)│
└───────────────┬──────────────────────┘
                │
                ▼
      Temporal Server / Temporal Cloud
```

## Release Lifecycle
1. `pnpm --filter @proompteng/temporal-bun-sdk run build` – compile ESM output and stage native bridges.
2. `pnpm --filter @proompteng/temporal-bun-sdk run test` – exercise Bun unit tests.
3. `pnpm pack --filter @proompteng/temporal-bun-sdk` – confirm the tarball includes Bun-native modules only.
4. Inspect the tarball to verify macOS/Linux bridge variants and absence of `@temporalio/*` deps.
5. `pnpm publish --filter @proompteng/temporal-bun-sdk --access public` when checks pass.
6. (Future) Replace the stubbed worker binary with the real implementation and extend validation to a workflow smoke test.

## Supporting Docs
- [packages/temporal-bun-sdk/docs/migration-guide.md](../packages/temporal-bun-sdk/docs/migration-guide.md)
- [packages/temporal-bun-sdk/docs/troubleshooting.md](../packages/temporal-bun-sdk/docs/troubleshooting.md)
- [packages/temporal-bun-sdk/examples/README.md](../packages/temporal-bun-sdk/examples/README.md)

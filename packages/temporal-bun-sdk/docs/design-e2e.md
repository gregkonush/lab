# Temporal Bun SDK — End-to-End Design

**Author:** Platform DX  
**Last Updated:** 17 Oct 2025  
**Status:** Final

---

## Goals

- Provide a Bun-only Temporal SDK that installs directly from npm with no git submodules or manual bridge compilation.
- Support macOS and Linux (x64/arm64) for both self-hosted Temporal clusters and Temporal Cloud.
- Ship reference docs—quickstart, migration, troubleshooting—inside the published package so practitioners on npm see the same guidance as the repository.

## Architecture Overview

```
┌──────────────────────────────────────┐
│ @proompteng/temporal-bun-sdk (npm)   │
│  ├─ dist/esm runtime + types         │
│  ├─ dist/native/libtemporal_*.{so,dylib} │
│  ├─ docs/, examples/                 │
│  └─ bin/temporal-bun-worker (Bun stub) │
└───────────────┬──────────────────────┘
                │ Bun FFI
                ▼
┌──────────────────────────────────────┐
│ temporal-sdk-core-c-bridge (prebuilt)│
│  └─ Compiled per target (x64/arm64)  │
└───────────────┬──────────────────────┘
                │
                ▼
      Temporal Server / Temporal Cloud
```

Key decisions:

- **Prebuilt bridge artifacts** live under `dist/native/<platform>/`, generated during release. Consumers no longer clone upstream repositories.
- **SDK surface area** re-exports curated modules (client, worker, workflow helpers) compiled for Bun’s runtime semantics.
- **Configuration helpers** (`loadTemporalConfig`, TLS/API key utilities) remove the need for app-specific boilerplate.
- **Examples and docs** ship alongside code so `pnpm pack` mirrors the published npm experience.
- **Worker runtime** ships as a stub while the Bun worker bridge is implemented; the CLI exits early with guidance instead of starting a worker.

## Package Layout

- `src/` – Bun-native TypeScript emitting ESM (no CommonJS shims).
- `dist/` – build output, bundling platform-specific bridges and type definitions.
- `docs/` – design, migration, and troubleshooting guides referenced from the README.
- `examples/` – `pnpm run demo` connectivity check (will evolve into a workflow demo once worker support lands).
- `tests/` – Bun unit tests covering configuration, TLS loading, and worker boot basics.

## Developer Experience

1. `pnpm add @proompteng/temporal-bun-sdk` installs the SDK plus docs.
2. `pnpm run demo` verifies client connectivity (optionally pair with the docker-compose stack under `examples/`).
3. `loadTemporalConfig()` reads `.env` files, enabling teams to switch between localhost, staging, and Temporal Cloud with environment overrides.
4. Migration from upstream packages happens in phases—see `docs/migration-guide.md` for drop-in commands and compatibility notes.
5. Worker execution remains a TODO; once the bridge lands we will update the demo and helpers accordingly.

## Release lifecycle

1. `pnpm --filter @proompteng/temporal-bun-sdk run build` – compile TypeScript, bundle platform bridges, and stage docs/examples in `dist/`.
2. `pnpm --filter @proompteng/temporal-bun-sdk run test` – execute Bun tests; add targeted integration suites as they land.
3. `pnpm pack --filter @proompteng/temporal-bun-sdk` – verify the tarball only includes Bun runtime modules, docs, and example assets.
4. Inspect the generated tarball (see validation checklist) to confirm native artifacts for macOS/Linux and absence of upstream `@temporalio/*` dependencies.
5. Publish with `pnpm publish --filter @proompteng/temporal-bun-sdk --access public` once validation passes.
6. (Future) Replace the stubbed worker binary with the FFI-backed implementation and extend validation to run workflow smoke tests.

## Documentation & Support

- **Quickstart:** README + `examples/README.md`.
- **Migration:** `docs/migration-guide.md` details Phase 0 → Phase 3 steps with commands.
- **Troubleshooting:** `docs/troubleshooting.md` covers native bridge errors, TLS setup, and CI environments.
- **Design history:** this document (package copy) plus the mirrored summary in `/docs/design-e2e.md` track the architecture intent for future updates.


## 6. Timeline (High-Level)

| Week | Milestone |
|------|-----------|
| 1 | Finish FFI implementation (runtime, client, worker, metrics) with unit tests |
| 2 | Adapt TS modules, verify `bun test` and manual workflow execution |
| 3 | Build integration example + docker-compose, Temporal Cloud configuration helpers |
| 4 | Polish docs, finalize npm packaging, release candidate |


## 7. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Upstream API changes | Pin to specific commits/tags; add update checklist |
| FFI errors causing runtime crashes | Add comprehensive unit tests; guard all pointers |
| Complex TLS/mTLS setup | Provide CLI checks & detailed docs |
| Bridge build friction for end-users | Offer optional prebuilt binaries or script to compile with Cargo |


## 8. Open Questions

1. Should we provide prebuilt bridge binaries for macOS/Linux to eliminate the Cargo step? (Would improve DX.)
2. Do we ship both TypeScript source and compiled JS, or compiled only? (Bun handles TS, but compiled JS reduces friction.)
3. Should the integration tests spin up a real dockerized Temporal server in CI? (Impacts runtime.)

---

This design doc captures the path to a production-ready, Bun-native Temporal SDK with first-class developer experience and Temporal Cloud support. It will live in `packages/temporal-bun-sdk/docs/design-e2e.md` so we can track progress and iterate as needed.

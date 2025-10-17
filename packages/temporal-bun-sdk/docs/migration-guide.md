# Migration Guide – `@proompteng/temporal-bun-sdk`

This guide walks teams from the upstream Temporal TypeScript SDK (`@temporalio/*`) to our Bun-first package. Roll out in phases so workflows keep running while you flip clients today and prepare for the upcoming Bun worker runtime.

## Phase 0 – Baseline (Upstream Only)
- Application depends on `@temporalio/client`, `@temporalio/worker`, etc.
- Workers run with Node.js and import upstream helpers.
- No action required yet; collect inventory of workflow bundles and activity modules that need to move.

## Phase 1 – Install the Bun SDK Next to Upstream
```bash
pnpm add @proompteng/temporal-bun-sdk
pnpm add -D bun-types
```

- Keep existing workers running.
- In parallel, run `pnpm run demo` to validate local connectivity.
- Update CI pipelines to install Bun (`curl -fsSL https://bun.sh/install | bash`).

## Phase 2 – Move Clients to Bun Helpers
```ts
import { createTemporalClient } from '@proompteng/temporal-bun-sdk'

const { client } = await createTemporalClient()
console.log('Connected to Temporal at', client.config.address)
client.close()
```

- Replace upstream `Connection.connect` calls with our helper.
- Remove manual TLS/API key wiring—the helper reads from `loadTemporalConfig()`.
- For services still on Node runtime, run clients via Bun (`bun run path/to/script.ts`) until the service port is migrated.
- Run regression tests: `pnpm test` or service-specific suites against the Bun client.

## Phase 3 – Swap Workers and Drop Upstream Dependencies
> **Heads-up:** Bun worker execution is still under development. The steps below mark out what Phase 3 will look like; keep your upstream workers in place until we ship the worker bridge.

- Track worker readiness in `docs/troubleshooting.md` (will call out milestones and release builds).
- Once the worker bridge lands, swap worker imports to `@proompteng/temporal-bun-sdk/worker` and remove upstream packages with `pnpm remove @temporalio/*`.
- Update workflow/activity imports to the Bun equivalents and re-run `pnpm run demo` (which will evolve into a true workflow exercise).

## Validation Checklist
- `rg '@temporalio/'` returns no runtime imports outside of migration history notes.
- `pnpm --filter @proompteng/temporal-bun-sdk run build && pnpm pack --filter @proompteng/temporal-bun-sdk` succeeds and the tarball contains Bun-native modules only.
- Track worker rollout in staging once the Bun worker image is published (pending).

Need more detail? See the [troubleshooting guide](./troubleshooting.md) for native bridge, TLS, and CI tips.

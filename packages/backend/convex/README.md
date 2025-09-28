# Convex backend

Author Convex functions for proompteng here.

- Add tables in `schema.ts` with `defineSchema`.
- Implement queries/mutations alongside in this directory.
- Run `pnpm --filter @proompteng/backend dev:setup` once to configure a Convex deployment.
- Start the dev server with `pnpm --filter @proompteng/backend dev`.
- Seed default model catalog entries with `pnpm run seed:models` (idempotent; skips if records already exist).

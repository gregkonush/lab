# AGENTS.md – Quick Reference for Automated Agents

## Build / Lint / Test Commands

- `pnpm install` – install all workspace dependencies.
- `pnpm run dev:<app>` – start dev server (e.g., `proompteng`).
- `pnpm run build:<app>` – production build for the specified app.
- `pnpm run start:<app>` – run the built app.
- `pnpm run lint:<app>` – run `next lint` for the app.
- `pnpm run format` – Biome formatter (writes changes).
- `pnpm run clean` – remove all `node_modules`.
- **Go services**: `go test ./...` – run all tests.
- Run a single Go test: `go test ./services/prt -run TestHandleRoot`.

## Code Style Guidelines

- **File naming**: kebab‑case for all source files (`*.tsx`, `*.go`).
- **Imports**: group as `standard → third‑party → internal`, each group separated by a blank line.
- **Formatting**: Biome (`biome format --write`) enforces 2‑space indent, single quotes, trailing commas, max line length 120.
- **TypeScript**: use explicit types, prefer `type` over `interface` for simple shapes, infer with `z.infer` when using Zod schemas.
- **React/Next**: Tailwind CSS for all styling, utility ordering `layout → spacing → sizing → typography → colors`. Use the `cn()` helper for conditional classNames.
- **Zod validation**: place schemas in a `schemas/` folder, use `zodResolver` with React Hook Form, validate API payloads with `safeParse`.
- **Error handling**:
  - JS/TS: `try { … } catch (err) { console.error(err); return res.status(500).json({error: err.message}); }`
  - Go: `if err != nil { return fmt.Errorf("operation failed: %w", err) }`
- **Naming conventions**:
  - Components: PascalCase, file name matches component (`my-component.tsx`).
  - Functions/variables: camelCase.
  - Constants: UPPER_SNAKE_CASE.
- **Accessibility**: include appropriate ARIA attributes, ensure 4.5:1 contrast, respect `prefers-reduced-motion`.
- **Cursor rules**: see `.cursor/rules/` – kebab‑case filenames, Tailwind‑only styling, Zod for schema validation.
- **Commit style**: use conventional commits, include concise “why” in the message.

*Agents should follow these guidelines when generating or modifying code.*

## ArgoCD, kubectl, and git preferences

- **kubectl**:
  - Use the current/default kube context. Do not pass a kubeconfig path unless explicitly requested.
  - Always scope with `-n <namespace>`; default to the app’s namespace (e.g., `kafka` for Kafka).
  - Prefer concise, read-only queries first; avoid long-lived watchers. Use label selectors and jsonpath for precision.
  - Use ephemeral `kubectl` actions only for restarts or debugging (e.g., `rollout restart`, `logs`). Avoid changing desired state via `kubectl apply` unless explicitly asked.

- **ArgoCD (GitOps)**:
  - Treat Git as the single source of truth; make edits under `argocd/` and let ArgoCD reconcile.
  - Do not install charts with the Helm CLI; declare charts via Kustomize `helmCharts` (or existing GitOps mechanism) and pin versions.
  - After file edits, the user will commit/push and sync the ArgoCD app. Only trigger sync/refresh on request.

- **git**:
  - Do not run git commands. Propose file edits only; the user will commit, push, and create PRs.
  - Follow conventional commits style and include the “why” when suggesting messages.
  - Never modify git configuration.

# Repository Guidelines

## Project Structure & Module Organization
- `apps/<app>` contains Next.js/Turbo UIs; keep UI fixtures and tests alongside components.
- Shared TS utilities stay in `packages/backend`; CDK8s blueprints sit in `packages/cloutt`.
- Go services live in `services/<service>` with `main.go` and adjacent `*_test.go` files.
- Infra-as-code spans `tofu/harvester` (OpenTofu), `kubernetes/` manifests, `argocd/` app specs, plus automation in `scripts/` and Ansible plays in `ansible/`.

## Build, Test & Development Commands
- Install dependencies with `pnpm install` (Node 22.19.0) and run `go mod tidy` inside each Go service.
- Start UIs with `pnpm run dev:proompteng`; swap the suffix for sibling apps.
- Build and smoke test via `pnpm run build:<app>` then `pnpm run start:<app>`.
- Format and lint using `pnpm run format` and `pnpm run lint:<app>`.
- Run backend workflows through `go test ./...` and `go build ./...`.
- Infra flow: `pnpm run tf:plan` (review), `pnpm run tf:apply` (approved), and `pnpm run ansible` for playbooks.

## Coding Style & Naming Conventions
- Run Biome before commits; it enforces two-space indentation, single quotes, trailing commas, and 120-character lines.
- Name files in kebab-case (`dialog-panel.tsx`, `cron-worker.go`).
- Order imports standard → third-party → internal with blank lines between groups.
- Compose React UI with Tailwind utilities via `cn()` and keep schema validation in `schemas/` using Zod.
- Wrap Go errors as `fmt.Errorf("operation failed: %w", err)`.

## Testing Guidelines
- Keep Go tests as `*_test.go` next to implementation; narrow runs with `go test ./services/prt -run TestHandleRoot`.
- Write TypeScript tests as `*.test.ts`; trigger scoped runs with `pnpm --filter cloutt exec jest` or the appropriate workspace filter.
- Target fast unit coverage first, then log manual QA steps in PR descriptions.

## Commit & Pull Request Guidelines
- Adopt Conventional Commits (e.g. `feat: add prix cache`); use bodies for extra context or breaking notes.
- PRs should summarize the change, link issues, list verification (`go test`, `pnpm run lint:<app>`), and attach UI screenshots when visuals shift.
- Keep scope tight, track follow-ups with TODOs, and document rollout or operational impacts.

## Security & Operations Notes
- ArgoCD reconciles desired state; edit manifests in `argocd/` or `kubernetes/` and let automation deploy.
- Pair Terraform plans from `pnpm run tf:plan` with review before `pnpm run tf:apply`; note outcomes after applies.
- Prefer read-only `kubectl -n <namespace> get ...` for production checks and capture findings in runbooks.

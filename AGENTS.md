# Repository Guidelines

## Project Structure & Module Organization
Apps under `apps/<app>` (Next.js/Turbo) hold UI surfaces; shared TS utilities live in `packages/backend`, and CDK8s manifests in `packages/cloutt`. Go microservices sit in `services/<service>` with `main.go` plus tests. Infra-as-code is split between `tofu/harvester` (OpenTofu), `kubernetes/` manifests, and Argo definitions under `argocd/`. Automation scripts are in `scripts/`, while Ansible playbooks stay in `ansible/`.

## Build, Test & Development Commands
Bootstrap with `pnpm install` (requires Node 22.19.0) and use `go mod tidy` inside Go services. Run a Next dev server via `pnpm run dev:proompteng` or swap the suffix for other apps. Ship builds with `pnpm run build:<app>` and verify with `pnpm run start:<app>`. Run linting through `pnpm run lint:<app>` and repo-wide formatting via `pnpm run format`. Execute Go workflows with `go test ./...` / `go build ./...`. Infra teams use `pnpm run tf:plan`, `pnpm run tf:apply`, and `pnpm run ansible` for cluster provisioning.

## Coding Style & Naming Conventions
Biome enforces two-space indentation, single quotes, trailing commas, and a 120-char line cap; run it before committing. Keep filenames in kebab-case (`dialog-panel.tsx`, `cron-worker.go`). Organize imports as standard -> third-party -> internal with blank lines between groups. React components rely on Tailwind utilities via `cn()`, and payload validation belongs in `schemas/` with Zod. Go errors should wrap context using `fmt.Errorf("operation failed: %w", err)`.

## Testing Guidelines
Place Go specs as `*_test.go` next to the source and scope targeted runs with `go test ./services/prt -run TestHandleRoot`. TypeScript tests should live as `*.test.ts` files; execute them within the owning workspace (for example `pnpm --filter cloutt exec jest`). Aim for quick unit coverage first, then note any manual verification steps in PRs.

## Commit & Pull Request Guidelines
Adopt Conventional Commits (`feat: add prix cache`) and explain the "why" in the commit body when needed. PRs should outline the change, reference related issues, attach screenshots for UI changes, and list verification steps (`go test`, `pnpm run lint:<app>`). Keep scope tight and flag follow-ups with TODOs.

## Infrastructure & Operations Notes
Cluster state is managed by ArgoCD, so change manifests in `argocd/` or `kubernetes/` and let reconciliation apply them. OpenTofu runs from `tofu/harvester`; always pair `tf:plan` reports with approvals before `tf:apply`. Use `kubectl -n <namespace> get ...` for read-only checks and document any rollouts in the PR.

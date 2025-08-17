# AGENTS.md – Quick Reference for Automated Agents

## Build / Lint / Test Commands

- `pnpm install` – install all workspace dependencies.
- `pnpm run dev:<app>` – start dev server (`proompteng`, `findbobastore`).
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

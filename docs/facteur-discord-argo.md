# facteur Discord ↔ Argo bridge scaffolding

The facteur service receives Discord bot commands and translates them into Argo workflow submissions. This document captures the configuration contract, high-level architecture, and deployment surfaces so future work can enable real integrations without restructuring the project.

## Configuration model

Configuration can be provided via a YAML file or environment variables (prefixed with `FACTEUR_`). The loader merges both sources with environment variables taking precedence.

### Required fields

| Path | Env var | Description |
| --- | --- | --- |
| `discord.bot_token` | `FACTEUR_DISCORD_BOT_TOKEN` | Discord bot token used for interactions API calls. |
| `discord.application_id` | `FACTEUR_DISCORD_APPLICATION_ID` | Discord application identifier for validating interaction payloads. |
| `redis.url` | `FACTEUR_REDIS_URL` | Redis connection string (e.g. `redis://host:6379/0`) for session storage. |
| `argo.namespace` | `FACTEUR_ARGO_NAMESPACE` | Kubernetes namespace containing the Argo Workflows controller. |
| `argo.workflow_template` | `FACTEUR_ARGO_WORKFLOW_TEMPLATE` | WorkflowTemplate name to clone when dispatching workflows. |

### Optional fields

| Path | Env var | Description |
| --- | --- | --- |
| `discord.public_key` | `FACTEUR_DISCORD_PUBLIC_KEY` | Discord public key for signature verification. |
| `discord.guild_id` | `FACTEUR_DISCORD_GUILD_ID` | Guild identifier used for scoping role checks. |
| `argo.service_account` | `FACTEUR_ARGO_SERVICE_ACCOUNT` | Service account name supplied to workflow submissions (defaults to controller value). |
| `argo.parameters` | `FACTEUR_ARGO_PARAMETERS` | Key/value overrides applied to every workflow submission. Expect a JSON object when sourced from env vars. |
| `role_map` | `FACTEUR_ROLE_MAP` | Mapping of command names to the Discord role IDs that can invoke them. See [role map schema](../schemas/facteur-discord-role-map.schema.json).

An example configuration is provided in `services/facteur/config/example.yaml`.

## Role map schema

The role map controls which Discord roles can invoke specific commands. Schema definition: `schemas/facteur-discord-role-map.schema.json`. Each key is a command name; the value is a non-empty array of Discord role IDs permitted to run that command.

## Service surfaces

- **CLI (`cmd/facteur`)** – Cobra-based commands; `facteur serve --config ./config/production.yaml` bootstraps the HTTP/Discord bridge.
- **Configuration (`internal/config`)** – Central loader for YAML + env with validation.
- **Discord handlers (`internal/discord`)** – Command routing, role enforcement, and session coordination.
- **Bridge (`internal/bridge`)** – Facade around Argo clients and business logic for workflow execution.
- **Session store (`internal/session`)** – Redis-backed storage for in-flight command interactions.
- **Argo integration (`internal/argo`)** – Workflow submission and status inspection plumbing.

## Deployment artifacts

- `services/facteur/Dockerfile` builds a distroless container.
- Pushes to `main` run `.github/workflows/facteur-build-push.yaml`, cross-building the image for linux/amd64 and linux/arm64 and publishing it to `registry.ide-newton.ts.net/lab/facteur`.
- Kubernetes manifests live under `kubernetes/facteur` (base + overlays) and include a Knative `Service`, ConfigMap, RBAC, a Redis custom resource, and WorkflowTemplate resources so the runtime can scale-to-zero when idle.
- `kubernetes/facteur/base/redis.yaml` provisions an in-cluster Redis instance via the OT-Container-Kit Redis Operator; confirm the platform `redis-operator` Application stays healthy before syncing facteur.
- Argo CD applications reside in `argocd/applications/facteur` and are referenced by `argocd/applicationsets/product.yaml` so the automation discovers and syncs the service.

## Next steps

Future issues will implement:

- Discord interaction handling (slash commands, component interactions).
- Authentication with real Discord and Argo APIs.
- Observability (logging, metrics, tracing) and operational runbooks.
- End-to-end validation against staging workflows.

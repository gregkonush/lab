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

## Codex knowledge base persistence

Facteur now owns a dedicated CloudNativePG cluster so Codex automation can persist the artefacts generated during `plan` → `implement` → `review` runs.

- Cluster: `facteur-vector-cluster` (namespace `facteur`) running `registry.ide-newton.ts.net/lab/vecteur:18-trixie`, three instances, 20&nbsp;Gi Longhorn volumes with data checksums enabled.
- Database: `facteur_kb`, owned by the `facteur` role. The bootstrap routine enables the `pgcrypto` and `vector` extensions before seeding schema objects.
- Connection secret: `facteur-vector-cluster-app` (namespace `facteur`). It follows the standard CloudNativePG app secret contract (`host`, `port`, `dbname`, `user`, `password`, `uri`). Mount or template this secret into consuming workloads to hydrate Codex clients.
- Schema: `codex_kb` with two tables.
  - `runs` – UUID primary key (defaults to `gen_random_uuid()`), stores `repo_slug`, `issue_number`, `workflow`, lifecycle timestamps, and JSONB `metadata`. Intended to capture one Codex execution per issue/workflow combination.
  - `entries` – UUID primary key with a foreign key to `runs.id`, carries `step_label`, `artifact_type`, `artifact_stage`, free-form `content`, JSONB `metadata`, and a `vector(1536)` embedding column. An IVFFLAT index (`codex_kb_entries_embedding_idx`, cosine distance, 100 lists) accelerates similarity search.
- Privileges: the bootstrap script assigns ownership of `runs` and `entries` to the `facteur` role, grants schema usage, applies direct CRUD privileges on existing tables, and sets default table grants so future objects remain writeable without extra migrations.

Future changes to the embedding dimensionality will require `ALTER TABLE codex_kb.entries ALTER COLUMN embedding TYPE vector(<new_dim>)` followed by `REINDEX INDEX codex_kb_entries_embedding_idx`.

## Initial command contract

The first public cut will ship three Discord slash commands that map to the existing workflow submission bridge. All commands run against the configured `argo.workflow_template`; the dispatcher injects an `action` parameter that mirrors the command name, and the Discord option names become workflow parameters after merging with static defaults defined under `argo.parameters`. The dispatcher still prefixes workflow names with the command that was invoked so we can trace intent in Argo.

| Command | Primary goal | Required options | Optional options | Workflow parameters |
| --- | --- | --- | --- | --- |
| `/plan` | Shape upcoming work and capture acceptance checkpoints. | `objective` | `project` | `action=plan`, `project`, `objective` |
| `/implement` | Kick off execution for an approved plan. | `project`, `branch` | `ticket`, `notes` | `action=implement`, `project`, `branch`, `ticket`, `notes` |
| `/review` | Collect artefacts for async review and notify approvers. | `project`, `artifact` | `notes`, `deadline` | `action=review`, `project`, `artifact`, `notes`, `deadline` |

### Event transport

Discord slash commands terminate at the shared webhook bridge (`apps/froussard`). The service verifies the Ed25519
signature (`x-signature-ed25519` and `x-signature-timestamp`), normalises the interaction into a stable payload, and
publishes it to Kafka topic `discord.commands.incoming` as an `application/x-protobuf` payload. The canonical contract
is `facteur.v1.CommandEvent` defined in `proto/facteur/v1/contract.proto`; generated stubs live under
`services/facteur/internal/facteurpb` (Go) and `apps/froussard/src/proto` (TypeScript). Facteur subscribes to that
topic, deserialises the message via the protobuf stubs, and drives the workflow dispatcher. Facteur is also responsible
for using the interaction token carried in the event to post follow-up updates back to Discord once the workflow
completes.

### `/plan`

- **Use case**: product or tech leads can request a structured plan for upcoming work. The backing workflow assembles a checklist, drafts milestones, and posts updates to downstream systems.
- **Discord options**:
  - `objective` (string, required) – short description of the desired outcome.
  - `project` (string, optional) – canonical project or repository slug; defaults to an implementation-specific fallback when omitted.
- **Workflow expectations**: the workflow template must accept parameters named `action`, `objective`, and `project`. When `project` is omitted, the bridge drops the key so downstream defaults apply.
- **Response contract**: facteur echoes the workflow name and namespace, and stores the `DispatchResult` in Redis (15-minute TTL) so follow-up commands can link back using the correlation ID.

### `/implement`

- **Use case**: engineers start implementation once planning is signed off. The workflow clones repositories, provisions feature environments, and updates status dashboards.
- **Discord options**:
  - `project` (string, required) – matches the `/plan` project slug to keep telemetry aligned.
  - `branch` (string, required) – Git branch that will host the work.
  - `ticket` (string, optional) – identifier for the tracking issue or ticket (e.g. JIRA, Linear).
  - `notes` (string, optional) – any extra instructions for the automation.
- **Workflow expectations**: parameters `action`, `project`, `branch`, `ticket`, and `notes` are provided. Empty optional values are omitted at submission time.
- **Response contract**: mirrors `/plan`, with the same Redis persistence so `/review` can automatically reference the most recent implementation run for the requesting user.

### `/review`

- **Use case**: request an asynchronous review of generated artefacts (PRs, docs, videos) and broadcast the workstream status.
- **Discord options**:
  - `project` (string, required) – consistent identifier carried across the other commands.
  - `artifact` (string, required) – URI or short handle pointing to the item under review.
  - `notes` (string, optional) – context for reviewers (e.g. areas needing attention).
  - `deadline` (string, optional) – ISO 8601 date to nudge reminders.
- **Workflow expectations**: workflow template consumes `action`, `project`, `artifact`, `notes`, and `deadline`. Facteur injects the last stored correlation ID (when present) as an additional parameter `last_correlation_id` so review automation can fetch logs or artefacts from previous steps.
- **Response contract**: if a cached `DispatchResult` exists, facteur appends `Last request correlation: <id>` to the Discord reply. Otherwise it only reports workflow submission status.

### Permission model

- Role assignments live under `role_map` in configuration. Each command should map to at least one Discord role ID; an empty entry makes the command publicly accessible.
- Recommended defaults:
  - `/plan`: product/tech lead roles (e.g. `bot.plan`).
  - `/implement`: engineering contributor roles (e.g. `bot.engineer`).
  - `/review`: allow both leads and engineers so that any stakeholder can trigger reviews.
- The handler short-circuits with a friendly error when the invoking user lacks the necessary role, and the request is not forwarded to Argo.

## Observability

Facteur initialises OpenTelemetry during startup, enabling spans and metrics across the HTTP server (via `otelfiber`), Kafka consumer, and Argo dispatcher. The Knative Service populates default LGTM endpoints:

| Variable | Value | Purpose |
| --- | --- | --- |
| `OTEL_SERVICE_NAME` | `facteur` | Identifies the service in telemetry backends. |
| `OTEL_SERVICE_NAMESPACE` | `metadata.namespace` | Mirrors the Kubernetes namespace in resource metadata. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | Aligns with LGTM's OTLP HTTP gateways. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `http://lgtm-tempo-gateway.lgtm.svc.cluster.local:4318/v1/traces` | Tempo ingestion endpoint. |
| `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | `http://lgtm-mimir-nginx.lgtm.svc.cluster.local/otlp/v1/metrics` | Mimir ingestion endpoint. |
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `http://lgtm-loki-gateway.lgtm.svc.cluster.local/loki/api/v1/push` | Loki ingestion endpoint (reserved for future log exporting). |

Locally, point the same variables at your LGTM environment to capture traces and metrics. Instrumentation surfaces counters such as `facteur_command_events_processed_total`, `facteur_command_events_failed_total`, and `facteur_command_events_dlq_total`, plus spans scoped to Kafka message handling and workflow submissions.

## Next steps

Future issues will implement:

- Discord interaction handling (slash commands, component interactions).
- Authentication with real Discord and Argo APIs.
- Operational runbooks and playbooks.
- End-to-end validation against staging workflows.

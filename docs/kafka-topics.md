# Kafka Topic Conventions

We namespace Kafka topics with dot notation (e.g. `github.webhook.events`) to make it obvious which producer owns the stream and what data shape to expect. The segments map to `<source>.<domain>.<entity>` and can be extended with additional qualifiers when needed (for example, `github.codex.tasks` for Codex-triggered automation).

## Working With Strimzi Manifests

Strimzi requires the Kubernetes `metadata.name` to follow DNS-1123 conventions (`[a-z0-9-]+`). When a topic contains dots, set the desired Kafka topic with `spec.topicName` and keep the resource name kebab-cased:

```yaml
apiVersion: kafka.strimzi.io/v1beta2
kind: KafkaTopic
metadata:
  name: github-webhook-events
  namespace: kafka
spec:
  topicName: github.webhook.events
  partitions: 3
  replicas: 3
```

## Producer & Consumer Configuration

- Application env vars (for example `KAFKA_TOPIC`) should reference the dot-notation topic (`github.webhook.events`).
- ACLs and SASL credentials should align with the dot-separated topic name—you do not need to mirror the kebab-case resource name.
- When creating new topics, follow the same `<source>.<domain>.<entity>` structure to keep observability and retention policies predictable.

## Existing Topics

| Kafka Topic | Purpose | Notes |
| ----------- | ------- | ----- |
| `discord.commands.incoming` | Normalized Discord slash command interactions published by Froussard. | Defined in `argocd/applications/froussard/discord-commands-topic.yaml`. 7-day retention. |
| `github.webhook.events` | Raw GitHub webhook payloads published by the `froussard` service. | Strimzi resource: `github-webhook-events`. 7-day retention. |
| `github.codex.tasks` | Issue-driven automation tasks consumed by Argo Workflows and Codex. | Defined in `argocd/applications/froussard/github-codex-topic.yaml`. |
| `github.issues.codex.tasks` | Structured Codex task payloads (protobuf) for services like Facteur. | Defined in `argocd/applications/froussard/github-issues-codex-tasks-topic.yaml`. |
| `argo.workflows.completions` | Normalized Argo Workflow completion events emitted by Argo Events. | Defined in `argocd/applications/froussard/argo-workflows-completions-topic.yaml`. Mirrors Codex topic retention (7 days). |

Add new rows whenever a topic is provisioned so downstream teams can reason about ownership and retention.

### Codex task payloads

Messages published to both `github.codex.tasks` (JSON) and `github.issues.codex.tasks` (Protobuf) include a `stage` field so downstream workflows can distinguish planning from implementation runs:

- `planning` – triggered when `gregkonush` opens an issue. The Codex container is expected to comment an execution plan on the issue using the marker `<!-- codex:plan -->` and stop.
- `implementation` – triggered automatically when the planning workflow posts a `<!-- codex:plan -->` comment (by `gregkonush`). The payload inlines that comment as the approved plan (`planCommentBody`) and still accepts a manual `execute plan` comment as a fallback.

Both stages carry the common metadata (`repository`, `base`, `head`, `issueNumber`, etc.) to keep the workflows symmetric.

The structured stream uses the `github.v1.CodexTask` message and adds the GitHub delivery identifier for consumers that need typed payloads.

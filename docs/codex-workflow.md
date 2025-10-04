# Codex Issue Automation Workflow

This guide explains how the two-stage Codex automation pipeline works and how to verify it after deployment.

## Architecture

1. **Froussard** consumes GitHub webhooks. When `gregkonush` opens an issue it publishes a `planning` message to `github.codex.tasks`. When the plan comment later receives a 👍 from the same user it publishes an `implementation` message.
2. **Argo Events** (`github-codex` EventSource/Sensor) consumes those Kafka messages and launches the `github-codex-task` `WorkflowTemplate`.
3. **WorkflowTemplate** runs the Codex container (`gpt-5-codex` with `--reasoning high --search --mode yolo`):
   - `stage=planning`: generate a `<!-- codex:plan -->` comment.
   - `stage=implementation`: follow the approved plan, push a branch, open a **draft** PR, and comment back with the results.

## Prerequisites

- Secrets `github-token` and `codex-openai` in `argo-workflows` namespace.
- Kafka topics `github.webhook.events` and `github.codex.tasks` deployed via Strimzi.
- Argo Events resources under `argocd/applications/froussard/` synced.

## Manual End-to-End Test

1. **Create a test issue** in `gregkonush/lab` (while logged in as `gregkonush`).
   - Check `argo get @latest -n argo-workflows` to see the planning workflow run.
   - Confirm the issue received a comment beginning with `<!-- codex:plan -->`.
2. **Approve the plan** with a 👍 reaction on that comment.
   - Watch for the implementation workflow; it should push a branch and open a draft PR.
   - The issue gains a follow-up comment linking to the PR.

## Helpful Commands

- Inspect workflows:
  ```bash
  argo list -n argo-workflows
  argo get <workflow-name> -n argo-workflows
  argo logs <workflow-name> -n argo-workflows
  ```
- Peek at Kafka traffic:
  ```bash
  kubectl -n kafka run kafka-cli --rm -it --image=strimzi/kafka:0.47.0-kafka-3.7.0 -- /bin/bash
  bin/kafka-console-consumer.sh --bootstrap-server kafka-kafka-bootstrap:9092 \
    --topic github.codex.tasks --from-beginning
  ```

## Direct Workflow Smoke Tests

Submit the template manually to isolate execution from GitHub/Kafka:

```bash
argo submit --from workflowtemplate/github-codex-task -n argo-workflows \
  -p stage=planning \
  -p prompt="Dry run" \
  -p repository=gregkonush/lab \
  -p base=main \
  -p head=codex/test \
  -p issueNumber=999 \
  -p issueUrl=https://github.com/gregkonush/lab/issues/999 \
  -p issueTitle="Codex dry run" \
  -p issueBody="Testing orchestration"
```

Repeat with `stage=implementation` and pass `planCommentBody` (the approved plan text) plus any comment metadata.

## Manifest & CI Safety Checks

Whenever you introduce a new Codex workflow or touch the surrounding manifests, run the validation scripts locally before opening a PR:

- `pnpm --filter froussard run test`
- `scripts/argo-lint.sh` (offline Argo lint of any Workflow/WorkflowTemplate YAML)
- `scripts/kubeconform.sh argocd` (kubeconform with custom CRD schemas)

Both lint scripts are what CI uses, so matching their output locally keeps Argo CD syncs clean.

## Troubleshooting

- **No plan comment**: verify the webhook secret/names.
- **Workflows not triggered**: check the `github-codex` sensor/eventsource pods.
- **Draft PR missing**: confirm the GitHub token has `repo` scope and the workflow pod can push.

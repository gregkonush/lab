# Codex Issue Automation Workflow

This document describes how the Codex planning/implementation pipeline works and how to exercise it after deployment.

## Architecture Overview

1. **Froussard service** receives GitHub webhooks. When user `gregkonush` opens an issue, it publishes a `planning` message to `github.codex.tasks`; when the same issue gets a 👍 reaction on the plan comment, it emits an `implementation` message.
2. **Argo Events** (`github-codex` EventSource/Sensor) consumes those Kafka messages and launches the `github-codex-task` `WorkflowTemplate`.
3. **WorkflowTemplate** runs the Codex container (`gpt-5-codex` with `--reasoning high --search --mode yolo`):
   - `stage=planning`: generate a `<!-- codex:plan -->` comment on the issue.
   - `stage=implementation`: clone the repo, execute the approved plan, push a branch, open a **draft** PR, and comment back on the issue.

## Prerequisites

- Secrets: `github-token` (PAT) and `codex-openai` (OpenAI key) in `argo-workflows` namespace.
- Kafka topics: `github.webhook.events`, `github.codex.tasks`.
- Argo Events resources under `argocd/applications/froussard/` synced.

## Manual Test Flow

1. **Create a test issue** in `gregkonush/lab` while logged in as `gregkonush`.
   - Within ~30s an Argo workflow should appear: `argo get @latest -n argo-workflows`.
   - Check the issue for a plan comment starting with `<!-- codex:plan -->`.
2. **Approve the plan** by reacting with 👍 to that comment (same user).
   - A second workflow runs for the implementation stage.
   - Expect a new branch, a draft PR, and an issue comment linking to it.

## Observability Commands

- Watch Kafka topics:
  ```bash
  kubectl -n kafka run kafka-cli --rm -it --image=strimzi/kafka:0.47.0-kafka-3.7.0 -- /bin/bash
  bin/kafka-console-consumer.sh --bootstrap-server kafka-kafka-bootstrap:9092 --topic github.codex.tasks --from-beginning
  ```

- Inspect workflows:
  ```bash
  argo list -n argo-workflows
  argo get <workflow-name> -n argo-workflows
  argo logs <workflow-name> -n argo-workflows
  ```

## Direct Workflow Tests

You can bypass GitHub/Kafka to validate the template:

```bash
argo submit --from workflowtemplate/github-codex-task -n argo-workflows \` \
  -p stage=planning \
  -p prompt="Simple dry run" \
  -p repository=gregkonush/lab \
  -p base=main \
  -p head=codex/test \
  -p issueNumber=999 \
  -p issueUrl=https://github.com/gregkonush/lab/issues/999 \
  -p issueTitle="Codex dry run" \
  -p issueBody="Testing orchestration"
```

Repeat with `stage=implementation` and supply `planCommentBody` (the plan text) plus optional comment metadata.

## CI Checks

- `pnpm --filter froussard run test`
- `scripts/argo-lint.sh` (offline Argo lint)
- `scripts/kubeconform.sh argocd` (Kubernetes manifests with custom schemas)

## Troubleshooting

- Missing plan comment: check Froussard logs for signature errors and confirm the GitHub secret is correct.
- Workflow not triggered: verify `github-codex` EventSource/Sensor pods are running and consuming the topic.
- Draft PR not created: ensure `github-token` has `repo` scope and the workflow pod can push.


# Codex Issue Automation Workflow

This guide explains how the two-stage Codex automation pipeline works and how to verify it after deployment.

## Architecture

1. **Froussard** consumes GitHub webhooks. When `gregkonush` opens an issue it publishes a `planning` message to `github.codex.tasks`. Comment keywords controlled by `CODEX_IMPLEMENTATION_TRIGGER` (default `execute plan`) and `CODEX_ONE_SHOT_TRIGGER` (default `execute one-shot`) publish `implementation` or `one-shot` messages with the metadata Codex needs for follow-up automation.
2. **Argo Events** (`github-codex` EventSource/Sensor) consumes those Kafka messages. The sensor now fans out to three workflow templates:
   - `github-codex-planning` for planning requests.
   - `github-codex-implementation` for approved plans.
   - `github-codex-one-shot` for combined runs that generate a plan and immediately execute it.
3. Each **WorkflowTemplate** runs the Codex container (`gpt-5-codex` with `--reasoning high --search --mode yolo`):
   - `stage=planning`: `codex-plan.sh` (via the `github-codex-planning` template) generates a `<!-- codex:plan -->` issue comment and logs its GH CLI output to `.codex-plan-output.md`.
   - `stage=implementation`: `codex-implement.sh` executes the approved plan, pushes the feature branch, opens a **draft** PR, maintains the `<!-- codex:progress -->` comment via `codex-progress-comment.sh`, and records the full interaction in `.codex-implementation.log` (uploaded as an Argo artifact).
   - `stage=one-shot`: `codex-one-shot.sh` runs `codex-plan.sh`, captures the generated plan, rewrites the event payload with that plan, and finally invokes `codex-implement.sh` so both stages complete inside a single workflow pod.

## Prerequisites

- Secrets `github-token` and `codex-openai` in `argo-workflows` namespace.
- Kafka topics `github.webhook.events` and `github.codex.tasks` deployed via Strimzi.
- Argo Events resources under `argocd/applications/froussard/` synced.
- Environment variables `CODEX_IMPLEMENTATION_TRIGGER` and `CODEX_ONE_SHOT_TRIGGER` set for the Froussard deployment (defaults `execute plan` / `execute one-shot`).

## Manual End-to-End Test

### Implementation Progress Comment Lifecycle

- Codex owns a single issue comment anchored by `<!-- codex:progress -->`; the helper at `apps/froussard/scripts/codex-progress-comment.sh` keeps it consistent.
- On implementation kickoff the helper seeds a checklist from the approved plan, marks the active step, and appends a short status section (tests run, blockers, next action).
- After every meaningful milestone the comment is updated in-place so reviewers can follow along without reading the Argo logs.
- When work finishes, the checklist is fully checked, the transient status block is replaced with the final summary/validation notes, and the same comment becomes the permanent implementation recap.
- Provide the comment body via stdin or `--body-file`; set `ISSUE_REPO`, `ISSUE_NUMBER`, and (optionally) `CODEX_PROGRESS_COMMENT_MARKER`/`CODEX_PROGRESS_COMMENT_LOG_PATH` before invoking the helper.
- Use `--dry-run` when validating changes locally—this prints the resolved body/action without mutating GitHub.

1. **Create a test issue** in `gregkonush/lab` (while logged in as `gregkonush`).
   - Check `argo get @latest -n argo-workflows` to see the planning workflow run via `github-codex-planning`.
   - Confirm the issue received a comment beginning with `<!-- codex:plan -->` that follows the Summary/Steps/Validation/Risks/Handoff Notes template.
2. **Approve the plan** by replying `execute plan` on the issue (as `gregkonush`).
   - Watch for a new workflow named `github-codex-implementation-*`; it should push a branch ( `codex/issue-<number>-*` ), open a draft PR, and upload `.codex-implementation.log` as an artifact.
   - Confirm a single progress comment remains on the issue, anchored by `<!-- codex:progress -->`, with the checklist reflecting the plan and validation state.
   - The issue gains a follow-up comment linking to the PR.
3. **Trigger a combined one-shot run** by commenting `execute one-shot` on a fresh issue (or reuse the test issue after clearing previous automation artifacts).
   - Expect a workflow named `github-codex-one-shot-*` that first posts a plan comment (check `.codex-plan-output.md` and the GitHub issue) and then executes the implementation phase without waiting for an additional human approval.
   - The workflow pod invokes `codex-one-shot.sh`, so you should see both `.codex-plan-output.md` and `.codex-implementation.log` artifacts attached to the same workflow.
   - If the implementation half fails, update the issue manually to capture rollback guidance and re-run once the failure is addressed.

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
argo submit --from workflowtemplate/github-codex-planning -n argo-workflows \
  -p rawEvent='{}' \
  -p eventBody='{"stage":"planning","prompt":"Dry run","repository":"gregkonush/lab","issueNumber":999,"base":"main","head":"codex/test","issueUrl":"https://github.com/gregkonush/lab/issues/999","issueTitle":"Codex dry run","issueBody":"Testing orchestration"}'
```

Trigger the implementation flow directly when you have an approved plan payload handy:

```bash
argo submit --from workflowtemplate/github-codex-implementation -n argo-workflows \
  -p rawEvent='{}' \
  -p eventBody='{"stage":"implementation","prompt":"<codex prompt>","repository":"gregkonush/lab","issueNumber":999,"base":"main","head":"codex/test","issueUrl":"https://github.com/gregkonush/lab/issues/999","issueTitle":"Codex dry run","issueBody":"Testing orchestration","planCommentBody":"<!-- codex:plan -->\n..."}'
```

Exercise the combined workflow without touching GitHub by providing both prompts. Ensure the implementation prompt includes the `{{CODEX_ONE_SHOT_PLAN_BODY}}` placeholder so the script can substitute the generated plan:

```bash
argo submit --from workflowtemplate/github-codex-one-shot -n argo-workflows \
  -p rawEvent='{}' \
  -p eventBody='{"stage":"one-shot","planningPrompt":"<planning prompt>","implementationPrompt":"Execute plan:\n{{CODEX_ONE_SHOT_PLAN_BODY}}","planPlaceholder":"{{CODEX_ONE_SHOT_PLAN_BODY}}","repository":"gregkonush/lab","issueNumber":999,"base":"main","head":"codex/test","issueUrl":"https://github.com/gregkonush/lab/issues/999","issueTitle":"Codex dry run","issueBody":"Testing orchestration"}'
```

The implementation workflow writes verbose output to `/workspace/lab/.codex-implementation.log`; inspect the artifact in Argo if you need the full Codex transcript.

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

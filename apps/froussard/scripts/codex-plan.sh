#!/usr/bin/env bash
set -euo pipefail

: "${CODEX_PROMPT:?CODEX_PROMPT environment variable is required}"
: "${ISSUE_REPO:?ISSUE_REPO environment variable is required}"
: "${ISSUE_NUMBER:?ISSUE_NUMBER environment variable is required}"

WORKTREE=${WORKTREE:-/workspace/lab}
BASE_BRANCH=${BASE_BRANCH:-main}
DEFAULT_OUTPUT_PATH=${PLAN_OUTPUT_PATH:-/workspace/lab/.codex-plan-output.md}
OUTPUT_PATH=${OUTPUT_PATH:-$DEFAULT_OUTPUT_PATH}
mkdir -p "$(dirname "$OUTPUT_PATH")"
export CODEX_STAGE=${CODEX_STAGE:-planning}
export RUST_LOG=${RUST_LOG:-codex_core=info,codex_exec=debug}
export RUST_BACKTRACE=${RUST_BACKTRACE:-1}

LGTM_LOKI_ENDPOINT=${LGTM_LOKI_ENDPOINT:-http://lgtm-loki-gateway.lgtm.svc.cluster.local/loki/api/v1/push}
JSON_OUTPUT_PATH=${JSON_OUTPUT_PATH:-/workspace/lab/.codex-plan-events.jsonl}
AGENT_OUTPUT_PATH=${AGENT_OUTPUT_PATH:-/workspace/lab/.codex-plan-agent.log}
mkdir -p "$(dirname "$JSON_OUTPUT_PATH")" "$(dirname "$AGENT_OUTPUT_PATH")"
: >"$JSON_OUTPUT_PATH"
: >"$AGENT_OUTPUT_PATH"
POST_RUN_SUMMARY_SCRIPT=${CODEX_POST_RUN_SCRIPT:-${WORKTREE}/apps/froussard/scripts/codex-post-run.sh}
PLANNING_SUMMARY_PATH=${PLANNING_SUMMARY_PATH:-${WORKTREE}/.codex-planning-summary.md}

push_codex_events_to_loki() {
  local stage="$1"
  local json_path="$2"
  local endpoint="$3"

  if [[ -z "$endpoint" ]]; then
    echo "LGTM Loki endpoint not configured; skipping log export" >&2
    return 0
  fi

  if [[ ! -s "$json_path" ]]; then
    echo "Codex JSON event log is empty; skipping log export" >&2
    return 0
  fi

  if ! command -v jq >/dev/null 2>&1; then
    echo "jq not available; cannot format Loki payload" >&2
    return 0
  fi

  local base_ts payload
  base_ts=$(date +%s%N)
  if ! payload=$(jq -sc --arg stage "$stage" --argjson base_ts "$base_ts" '
      def entry_ts($base; $idx): ($base + ($idx | tonumber));
      {streams:[
        {stream:{job:"codex-exec",stage:$stage},
         values:(to_entries | map( [ (entry_ts($base_ts; .key) | tostring), (.value | tojson) ] ))}
      ]}
    ' "$json_path"); then
    echo "Failed to build Loki payload from Codex JSON events" >&2
    return 0
  fi

  if [[ "$payload" == '{"streams":[]}' ]]; then
    echo "Codex JSON event payload empty; skipping log export" >&2
    return 0
  fi

  if ! curl -fsS -X POST -H "Content-Type: application/json" --data "$payload" "$endpoint" >/dev/null; then
    echo "Failed to push Codex events to Loki at $endpoint" >&2
    return 1
  fi

  echo "Pushed Codex events to Loki at $endpoint" >&2
  return 0
}

RELAY_SCRIPT=${RELAY_SCRIPT:-apps/froussard/scripts/discord-relay.ts}
RELAY_TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)
RELAY_RUN_ID=${CODEX_RELAY_RUN_ID:-${ARGO_WORKFLOW_NAME:-${ARGO_WORKFLOW_UID:-}}}

if [[ -z "${RELAY_RUN_ID}" ]]; then
  RELAY_RUN_ID=$(python3 - <<'PY'
import random
alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
print(''.join(random.choice(alphabet) for _ in range(6)))
PY
)
fi

RELAY_RUN_ID=${RELAY_RUN_ID:0:24}
RELAY_RUN_ID=$(printf '%s' "$RELAY_RUN_ID" | tr '[:upper:]' '[:lower:]')

DISCORD_READY=0
if [[ -n "${DISCORD_BOT_TOKEN:-}" && -n "${DISCORD_GUILD_ID:-}" && -f "$RELAY_SCRIPT" ]]; then
  if command -v bun >/dev/null 2>&1; then
    DISCORD_READY=1
  else
    echo "Discord relay disabled: bun not available in PATH" >&2
  fi
else
  echo "Discord relay disabled: missing credentials or relay script" >&2
fi

relay_cmd=(bun run "$RELAY_SCRIPT")

PROMPT=$(python3 - <<'PY'
import os, textwrap

base_prompt = textwrap.dedent(os.environ['CODEX_PROMPT']).strip()
issue_repo = os.environ['ISSUE_REPO']
issue_number = os.environ['ISSUE_NUMBER']
worktree = os.environ.get('WORKTREE', '/workspace/lab')
base_branch = os.environ.get('BASE_BRANCH', 'main')

addon = textwrap.dedent(f"""
Execution notes (do not restate plan requirements above):
- Work from the existing checkout at {worktree}, already aligned with origin/{base_branch}.
- After generating the plan, write it to PLAN.md.
- Post it with `gh issue comment --repo {issue_repo} {issue_number} --body-file PLAN.md`.
- Echo the final plan (PLAN.md contents) and the GH CLI output to stdout.
- If posting fails, surface the GH error and exit non-zero; otherwise exit 0.
""").strip()

print(f"{base_prompt}\n\n{addon}")
PY
)

if [[ "$DISCORD_READY" -eq 1 ]]; then
  relay_args=(--stage plan --repo "$ISSUE_REPO" --issue "$ISSUE_NUMBER" --timestamp "$RELAY_TIMESTAMP")
  if [[ -n "$RELAY_RUN_ID" ]]; then
    relay_args+=(--run-id "$RELAY_RUN_ID")
  fi
  if [[ -n "${ISSUE_TITLE:-}" ]]; then
    relay_args+=(--title "$ISSUE_TITLE")
  fi
  if [[ "${DISCORD_RELAY_DRY_RUN:-}" == "1" ]]; then
    relay_args+=(--dry-run)
  fi
  set +e
  set +o pipefail
  printf '%s' "$PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox --json --output-last-message "$OUTPUT_PATH" - \
    | tee >(cat >"$JSON_OUTPUT_PATH") \
    | jq -r 'select(.type == "item.completed" and .item.type == "agent_message") | .item.text // empty' \
    | tee >("${relay_cmd[@]}" "${relay_args[@]}") >(cat >"$AGENT_OUTPUT_PATH")
  pipeline_status=$?
  pipe_statuses=("${PIPESTATUS[@]}")
  set -o pipefail
  set -e

  codex_status=${pipe_statuses[1]:-1}
  jq_status=${pipe_statuses[3]:-1}
  relay_status=${pipe_statuses[4]:-1}

  if [[ $codex_status -ne 0 ]]; then
    echo "Codex execution failed" >&2
    exit 1
  fi

  if [[ $jq_status -ne 0 ]]; then
    echo "jq pipeline exited with status $jq_status during Codex run" >&2
  fi

  if [[ $pipeline_status -ne 0 ]]; then
    if [[ $relay_status -ne 0 ]]; then
      echo "Discord relay failed (status $relay_status); continuing without Discord mirror" >&2
    fi
  fi
else
  set +e
  set +o pipefail
  printf '%s' "$PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox --json --output-last-message "$OUTPUT_PATH" - \
    | tee >(cat >"$JSON_OUTPUT_PATH") \
    | jq -r 'select(.type == "item.completed" and .item.type == "agent_message") | .item.text // empty' \
    | tee >(cat >"$AGENT_OUTPUT_PATH")
  pipeline_status=$?
  pipe_statuses=("${PIPESTATUS[@]}")
  set -o pipefail
  set -e

  codex_status=${pipe_statuses[1]:-1}
  jq_status=${pipe_statuses[3]:-1}

  if [[ $codex_status -ne 0 ]]; then
    echo "Codex execution failed" >&2
    exit 1
  fi

  if [[ $jq_status -ne 0 ]]; then
    echo "jq pipeline exited with status $jq_status during Codex run" >&2
  fi
fi

if [[ ! -s "$OUTPUT_PATH" && -s "$AGENT_OUTPUT_PATH" ]]; then
  cp "$AGENT_OUTPUT_PATH" "$OUTPUT_PATH"
fi

if command -v jq >/dev/null 2>&1; then
  push_codex_events_to_loki "$CODEX_STAGE" "$JSON_OUTPUT_PATH" "$LGTM_LOKI_ENDPOINT" || true
else
  echo "Skipping Loki export because jq is not installed" >&2
fi

if [[ -x "$POST_RUN_SUMMARY_SCRIPT" ]]; then
  SUMMARY_PATH="$PLANNING_SUMMARY_PATH" "$POST_RUN_SUMMARY_SCRIPT" "$AGENT_OUTPUT_PATH" "$CODEX_STAGE" "$codex_status" "planning run" || \
    echo "Post-run summary failed for planning stage" >&2
else
  echo "Skipping post-run summary: script '$POST_RUN_SUMMARY_SCRIPT' missing or not executable" >&2
fi

if [[ -s "$OUTPUT_PATH" ]]; then
  echo "Codex plan output:" >&2
  cat "$OUTPUT_PATH" >&2
fi

echo "Codex interaction logged to $OUTPUT_PATH"
if [[ -s "$JSON_OUTPUT_PATH" ]]; then
  echo "Codex JSON events stored at $JSON_OUTPUT_PATH" >&2
fi

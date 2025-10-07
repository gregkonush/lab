#!/usr/bin/env bash
set -euo pipefail

EVENT_PATH=${1:-}
if [[ -z "$EVENT_PATH" ]]; then
  echo "Usage: codex-implement.sh <event-json-path>" >&2
  exit 1
fi

if [[ ! -f "$EVENT_PATH" ]]; then
  echo "Event payload file not found at '$EVENT_PATH'" >&2
  exit 1
fi

WORKTREE=${WORKTREE:-/workspace/lab}
DEFAULT_OUTPUT_PATH="${WORKTREE}/.codex-implementation.log"
OUTPUT_PATH=${OUTPUT_PATH:-$DEFAULT_OUTPUT_PATH}

mkdir -p "$(dirname "$OUTPUT_PATH")"

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
  if command -v bunx >/dev/null 2>&1; then
    DISCORD_READY=1
  else
    echo "Discord relay disabled: bunx not available in PATH" >&2
  fi
else
  echo "Discord relay disabled: missing credentials or relay script" >&2
fi

relay_cmd=(bunx tsx "$RELAY_SCRIPT")

event_prompt=$(jq -r '.prompt // empty' "$EVENT_PATH")
if [[ -z "$event_prompt" ]]; then
  echo "Missing Codex prompt in event payload" >&2
  exit 1
fi

event_repo=$(jq -r '.repository // empty' "$EVENT_PATH")
if [[ -z "$event_repo" || "$event_repo" == "null" ]]; then
  echo "Missing repository metadata in event payload" >&2
  exit 1
fi

event_issue_number=$(jq -r '.issueNumber // empty' "$EVENT_PATH")
if [[ -z "$event_issue_number" || "$event_issue_number" == "null" ]]; then
  echo "Missing issue number metadata in event payload" >&2
  exit 1
fi

event_issue_title=$(jq -r '.issueTitle // empty' "$EVENT_PATH")
if [[ "$event_issue_title" == "null" ]]; then
  event_issue_title=""
fi

event_base_branch=$(jq -r '.base // empty' "$EVENT_PATH")
if [[ -n "$event_base_branch" && "$event_base_branch" != "null" ]]; then
  BASE_BRANCH="$event_base_branch"
fi
BASE_BRANCH=${BASE_BRANCH:-main}

event_head_branch=$(jq -r '.head // empty' "$EVENT_PATH")
if [[ -n "$event_head_branch" && "$event_head_branch" != "null" ]]; then
  HEAD_BRANCH="$event_head_branch"
fi

plan_comment_id=$(jq -r '.planCommentId // empty' "$EVENT_PATH")
if [[ "$plan_comment_id" == "null" ]]; then
  plan_comment_id=""
fi

plan_comment_url=$(jq -r '.planCommentUrl // empty' "$EVENT_PATH")
if [[ "$plan_comment_url" == "null" ]]; then
  plan_comment_url=""
fi

plan_comment_body=$(jq -r '.planCommentBody // empty' "$EVENT_PATH")
if [[ "$plan_comment_body" == "null" ]]; then
  plan_comment_body=""
fi

export CODEX_PROMPT="$event_prompt"
export ISSUE_REPO="$event_repo"
export ISSUE_NUMBER="$event_issue_number"
export BASE_BRANCH
export HEAD_BRANCH=${HEAD_BRANCH:-}
export PLAN_COMMENT_ID="$plan_comment_id"
export PLAN_COMMENT_URL="$plan_comment_url"
export PLAN_COMMENT_BODY="$plan_comment_body"
export WORKTREE
export OUTPUT_PATH
export ISSUE_TITLE=${ISSUE_TITLE:-$event_issue_title}
export CODEX_STAGE=${CODEX_STAGE:-implementation}

echo "Running Codex implementation for ${ISSUE_REPO}#${ISSUE_NUMBER}" >&2

if [[ "$DISCORD_READY" -eq 1 ]]; then
  relay_args=(--stage implementation --repo "$ISSUE_REPO" --issue "$ISSUE_NUMBER" --timestamp "$RELAY_TIMESTAMP")
  if [[ -n "$RELAY_RUN_ID" ]]; then
    relay_args+=(--run-id "$RELAY_RUN_ID")
  fi
  if [[ -n "$event_issue_title" ]]; then
    relay_args+=(--title "$event_issue_title")
  fi
  if [[ "${DISCORD_RELAY_DRY_RUN:-}" == "1" ]]; then
    relay_args+=(--dry-run)
  fi
  if ! printf '%s' "$CODEX_PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox - | tee >("${relay_cmd[@]}" "${relay_args[@]}") "$OUTPUT_PATH"; then
    echo "Codex execution failed" >&2
    exit 1
  fi
else
  if ! printf '%s' "$CODEX_PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox - | tee "$OUTPUT_PATH"; then
    echo "Codex execution failed" >&2
    exit 1
  fi
fi

echo "Codex execution logged to $OUTPUT_PATH" >&2

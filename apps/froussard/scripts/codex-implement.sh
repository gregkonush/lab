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

export CODEX_STAGE=${CODEX_STAGE:-implementation}
export RUST_LOG=${RUST_LOG:-codex_core=info,codex_exec=debug}
export RUST_BACKTRACE=${RUST_BACKTRACE:-1}

LGTM_LOKI_ENDPOINT=${LGTM_LOKI_ENDPOINT:-http://lgtm-loki-gateway.lgtm.svc.cluster.local/loki/api/v1/push}
JSON_OUTPUT_PATH=${JSON_OUTPUT_PATH:-/workspace/lab/.codex-implementation-events.jsonl}
AGENT_OUTPUT_PATH=${AGENT_OUTPUT_PATH:-/workspace/lab/.codex-implementation-agent.log}
mkdir -p "$(dirname "$JSON_OUTPUT_PATH")" "$(dirname "$AGENT_OUTPUT_PATH")"
: >"$JSON_OUTPUT_PATH"
: >"$AGENT_OUTPUT_PATH"

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

path_for_attempt() {
  local base_path=$1
  local attempt_idx=$2

  if [[ -z "$base_path" ]]; then
    echo ""
    return
  fi

  local dir filename stem ext
  dir=$(dirname "$base_path")
  filename=$(basename "$base_path")
  stem=$filename
  ext=""

  if [[ "$filename" == *.* ]]; then
    ext=".${filename##*.}"
    stem=${filename%.*}
  fi

  printf '%s/%s.attempt%s%s\n' "$dir" "$stem" "$attempt_idx" "$ext"
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
POST_RUN_SUMMARY_SCRIPT=${CODEX_POST_RUN_SCRIPT:-${WORKTREE}/apps/froussard/scripts/codex-post-run.sh}
IMPLEMENTATION_SUMMARY_PATH=${IMPLEMENTATION_SUMMARY_PATH:-${WORKTREE}/.codex-implementation-summary.md}

MAX_ATTEMPTS_RAW=${CODEX_IMPLEMENTATION_MAX_ATTEMPTS:-${CODEX_MAX_ATTEMPTS:-2}}
if ! [[ "$MAX_ATTEMPTS_RAW" =~ ^[0-9]+$ ]] || [[ "$MAX_ATTEMPTS_RAW" -lt 1 ]]; then
  MAX_ATTEMPTS=2
else
  MAX_ATTEMPTS=$MAX_ATTEMPTS_RAW
fi

relay_args_base=()

echo "Running Codex implementation for ${ISSUE_REPO}#${ISSUE_NUMBER}" >&2

if [[ "$DISCORD_READY" -eq 1 ]]; then
  relay_args_base=(--stage implementation --repo "$ISSUE_REPO" --issue "$ISSUE_NUMBER" --timestamp "$RELAY_TIMESTAMP")
  if [[ -n "$RELAY_RUN_ID" ]]; then
    relay_args_base+=(--run-id "$RELAY_RUN_ID")
  fi
  if [[ -n "$event_issue_title" ]]; then
    relay_args_base+=(--title "$event_issue_title")
  fi
  if [[ "${DISCORD_RELAY_DRY_RUN:-}" == "1" ]]; then
    relay_args_base+=(--dry-run)
  fi
fi

run_codex_attempt() {
  local attempt=$1
  local attempt_label=$2
  local use_discord=$3
  local attempt_output_path=$4
  local attempt_json_path=$5
  local attempt_agent_path=$6

  mkdir -p "$(dirname "$attempt_output_path")" "$(dirname "$attempt_json_path")" "$(dirname "$attempt_agent_path")"
  : >"$attempt_json_path"
  : >"$attempt_agent_path"

  local pipeline_status=0
  local codex_status=0
  local jq_status=0
  local relay_status=0

  set +e
  set +o pipefail
  if [[ "$use_discord" -eq 1 && "$DISCORD_READY" -eq 1 ]]; then
    local relay_args=("${relay_args_base[@]}")
    printf '%s' "$CODEX_PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox --json --output-last-message "$attempt_output_path" - \
      | tee >(cat >"$attempt_json_path") \
      | jq -r 'select(.type == "item.completed" and .item.type == "agent_message") | .item.text // empty' \
      | tee >("${relay_cmd[@]}" "${relay_args[@]}") >(cat >"$attempt_agent_path")
    pipeline_status=$?
    local pipe_statuses=("${PIPESTATUS[@]}")
    codex_status=${pipe_statuses[1]:-1}
    jq_status=${pipe_statuses[3]:-1}
    relay_status=${pipe_statuses[4]:-1}
  else
    printf '%s' "$CODEX_PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox --json --output-last-message "$attempt_output_path" - \
      | tee >(cat >"$attempt_json_path") \
      | jq -r 'select(.type == "item.completed" and .item.type == "agent_message") | .item.text // empty' \
      | tee >(cat >"$attempt_agent_path")
    pipeline_status=$?
    local pipe_statuses=("${PIPESTATUS[@]}")
    codex_status=${pipe_statuses[1]:-1}
    jq_status=${pipe_statuses[3]:-1}
  fi
  set -o pipefail
  set -e

  if [[ $codex_status -ne 0 ]]; then
    echo "Codex execution failed on ${attempt_label} (exit $codex_status)" >&2
  fi

  if [[ $jq_status -ne 0 ]]; then
    echo "jq pipeline exited with status $jq_status during Codex run (${attempt_label})" >&2
  fi

  if [[ $pipeline_status -ne 0 && $relay_status -ne 0 && "$use_discord" -eq 1 && "$DISCORD_READY" -eq 1 ]]; then
    echo "Discord relay failed on ${attempt_label} (status $relay_status); continuing without Discord mirror" >&2
  fi

  if [[ ! -s "$attempt_output_path" && -s "$attempt_agent_path" ]]; then
    cp "$attempt_agent_path" "$attempt_output_path"
  fi

  if command -v jq >/dev/null 2>&1; then
    push_codex_events_to_loki "$CODEX_STAGE" "$attempt_json_path" "$LGTM_LOKI_ENDPOINT" || true
  else
    echo "Skipping Loki export because jq is not installed" >&2
  fi

  if [[ -x "$POST_RUN_SUMMARY_SCRIPT" ]]; then
    SUMMARY_PATH="$IMPLEMENTATION_SUMMARY_PATH" "$POST_RUN_SUMMARY_SCRIPT" "$attempt_agent_path" "$CODEX_STAGE" "$codex_status" "$attempt_label" || \
      echo "Post-run summary failed for ${attempt_label}" >&2
  else
    echo "Skipping post-run summary: script '$POST_RUN_SUMMARY_SCRIPT' missing or not executable" >&2
  fi

  LAST_OUTPUT_PATH="$attempt_output_path"
  LAST_JSON_PATH="$attempt_json_path"
  LAST_AGENT_PATH="$attempt_agent_path"

  return "$codex_status"
}

final_status=1
LAST_OUTPUT_PATH=""
LAST_JSON_PATH=""
LAST_AGENT_PATH=""

attempt=1
while [[ $attempt -le $MAX_ATTEMPTS ]]; do
  attempt_label="attempt ${attempt}/${MAX_ATTEMPTS}"
  attempt_output_path=$(path_for_attempt "$OUTPUT_PATH" "$attempt")
  attempt_json_path=$(path_for_attempt "$JSON_OUTPUT_PATH" "$attempt")
  attempt_agent_path=$(path_for_attempt "$AGENT_OUTPUT_PATH" "$attempt")
  use_discord=0
  if [[ $attempt -eq 1 && "$DISCORD_READY" -eq 1 ]]; then
    use_discord=1
  fi

  run_codex_attempt "$attempt" "$attempt_label" "$use_discord" "$attempt_output_path" "$attempt_json_path" "$attempt_agent_path"
  attempt_status=$?

  if [[ $attempt_status -eq 0 ]]; then
    final_status=0
    break
  fi

  if [[ $attempt -ge $MAX_ATTEMPTS ]]; then
    final_status=$attempt_status
    break
  fi

  echo "Retrying Codex implementation (next attempt) after ${attempt_label} failed" >&2
  attempt=$((attempt + 1))
done

if [[ -n "$LAST_OUTPUT_PATH" && "$LAST_OUTPUT_PATH" != "$OUTPUT_PATH" ]]; then
  cp "$LAST_OUTPUT_PATH" "$OUTPUT_PATH"
fi

if [[ -n "$LAST_JSON_PATH" && "$LAST_JSON_PATH" != "$JSON_OUTPUT_PATH" ]]; then
  cp "$LAST_JSON_PATH" "$JSON_OUTPUT_PATH"
fi

if [[ -n "$LAST_AGENT_PATH" && "$LAST_AGENT_PATH" != "$AGENT_OUTPUT_PATH" ]]; then
  cp "$LAST_AGENT_PATH" "$AGENT_OUTPUT_PATH"
fi

if [[ -s "$OUTPUT_PATH" ]]; then
  echo "Codex execution logged to $OUTPUT_PATH" >&2
fi
if [[ -s "$JSON_OUTPUT_PATH" ]]; then
  echo "Codex JSON events stored at $JSON_OUTPUT_PATH" >&2
fi
if [[ -s "$IMPLEMENTATION_SUMMARY_PATH" ]]; then
  echo "Codex summary stored at $IMPLEMENTATION_SUMMARY_PATH" >&2
fi

exit "$final_status"

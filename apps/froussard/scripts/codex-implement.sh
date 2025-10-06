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

echo "Running Codex implementation for ${ISSUE_REPO}#${ISSUE_NUMBER}" >&2

if ! printf '%s' "$CODEX_PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox - | tee "$OUTPUT_PATH"; then
  echo "Codex execution failed" >&2
  exit 1
fi

echo "Codex execution logged to $OUTPUT_PATH" >&2

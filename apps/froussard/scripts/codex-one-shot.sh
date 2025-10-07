#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: codex-one-shot.sh <event-json-path>" >&2
  exit 1
fi

EVENT_PATH=$1
if [[ ! -f "$EVENT_PATH" ]]; then
  echo "Event payload file not found at '$EVENT_PATH'" >&2
  exit 1
fi

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WORKTREE=${WORKTREE:-/workspace/lab}
PLAN_FILE=${PLAN_FILE:-${WORKTREE}/PLAN.md}
DEFAULT_PLAN_OUTPUT_PATH=${PLAN_OUTPUT_PATH:-${WORKTREE}/.codex-plan-output.md}

STAGE=$(jq -r '.stage // empty' "$EVENT_PATH")
if [[ "$STAGE" != "one-shot" ]]; then
  echo "Skipping unsupported stage: '$STAGE'" >&2
  exit 0
fi

PLANNING_PROMPT=$(jq -r '.planningPrompt // empty' "$EVENT_PATH")
if [[ -z "$PLANNING_PROMPT" ]]; then
  echo "Missing planning prompt in event payload" >&2
  exit 1
fi

IMPLEMENTATION_PROMPT=$(jq -r '.implementationPrompt // empty' "$EVENT_PATH")
if [[ -z "$IMPLEMENTATION_PROMPT" ]]; then
  echo "Missing implementation prompt template in event payload" >&2
  exit 1
fi

PLAN_PLACEHOLDER=$(jq -r '.planPlaceholder // empty' "$EVENT_PATH")
if [[ -z "$PLAN_PLACEHOLDER" || "$PLAN_PLACEHOLDER" == "null" ]]; then
  PLAN_PLACEHOLDER='{{CODEX_ONE_SHOT_PLAN_BODY}}'
fi

ISSUE_REPO=$(jq -r '.repository // empty' "$EVENT_PATH")
if [[ -z "$ISSUE_REPO" || "$ISSUE_REPO" == "null" ]]; then
  echo "Missing repository metadata in event payload" >&2
  exit 1
fi

ISSUE_NUMBER=$(jq -r '.issueNumber // empty' "$EVENT_PATH")
if [[ -z "$ISSUE_NUMBER" || "$ISSUE_NUMBER" == "null" ]]; then
  echo "Missing issue number metadata in event payload" >&2
  exit 1
fi

BASE_BRANCH_VALUE=$(jq -r '.base // empty' "$EVENT_PATH")
if [[ -n "$BASE_BRANCH_VALUE" && "$BASE_BRANCH_VALUE" != "null" ]]; then
  export BASE_BRANCH="$BASE_BRANCH_VALUE"
fi

HEAD_BRANCH_VALUE=$(jq -r '.head // empty' "$EVENT_PATH")
if [[ -n "$HEAD_BRANCH_VALUE" && "$HEAD_BRANCH_VALUE" != "null" ]]; then
  export HEAD_BRANCH="$HEAD_BRANCH_VALUE"
fi

export WORKTREE
export PLAN_OUTPUT_PATH="$DEFAULT_PLAN_OUTPUT_PATH"
export CODEX_PROMPT="$PLANNING_PROMPT"
export ISSUE_REPO
export ISSUE_NUMBER

if [[ -f "$PLAN_FILE" ]]; then
  rm -f "$PLAN_FILE"
fi

echo "Running Codex planning for ${ISSUE_REPO}#${ISSUE_NUMBER}" >&2
"${SCRIPT_DIR}/codex-plan.sh"

if [[ ! -s "$PLAN_FILE" ]]; then
  echo "Plan file not generated at '$PLAN_FILE'" >&2
  exit 1
fi

TMP_JSON=$(mktemp)
PLAN_PLACEHOLDER="$PLAN_PLACEHOLDER" \
IMPLEMENTATION_PROMPT="$IMPLEMENTATION_PROMPT" \
PLAN_FILE="$PLAN_FILE" \
python3 - <<'PY'
import json
import os
import sys
from pathlib import Path

plan_file = Path(os.environ['PLAN_FILE'])
plan_body = plan_file.read_text(encoding='utf-8').strip()
if not plan_body:
    print(f"Plan file '{plan_file}' is empty", file=sys.stderr)
    sys.exit(1)

implementation_prompt = os.environ['IMPLEMENTATION_PROMPT']
placeholder = os.environ['PLAN_PLACEHOLDER']
if placeholder not in implementation_prompt:
    print(f"Placeholder '{placeholder}' not found in implementation prompt", file=sys.stderr)
    sys.exit(1)

final_prompt = implementation_prompt.replace(placeholder, plan_body)
json.dump({'plan_body': plan_body, 'final_prompt': final_prompt}, sys.stdout)
PY

UPDATED_PROMPT=$(jq -r '.final_prompt' "$TMP_JSON")
PLAN_BODY=$(jq -r '.plan_body' "$TMP_JSON")
rm -f "$TMP_JSON"

TMP_EVENT=$(mktemp)
jq --arg prompt "$UPDATED_PROMPT" \
   --arg plan "$PLAN_BODY" \
   '.previousStage = (.previousStage // .stage) | .prompt = $prompt | .planCommentBody = $plan | .stage = "implementation"' \
   "$EVENT_PATH" > "$TMP_EVENT"
mv "$TMP_EVENT" "$EVENT_PATH"

export PLAN_COMMENT_BODY="$PLAN_BODY"

echo "Running Codex implementation for ${ISSUE_REPO}#${ISSUE_NUMBER}" >&2
"${SCRIPT_DIR}/codex-implement.sh" "$EVENT_PATH"

#!/usr/bin/env bash
set -euo pipefail

EVENT_PATH=${1:-}
if [[ -z "$EVENT_PATH" ]]; then
  echo "Usage: codex-one-shot.sh <event-json-path>" >&2
  exit 1
fi

if [[ ! -f "$EVENT_PATH" ]]; then
  echo "Event payload file not found at '$EVENT_PATH'" >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to process Codex one-shot events" >&2
  exit 1
fi

PLACEHOLDER="__CODEX_ONE_SHOT_PLAN_PLACEHOLDER__"

planning_prompt=$(jq -r '.prompts.planning // empty' "$EVENT_PATH")
if [[ -z "$planning_prompt" || "$planning_prompt" == "null" ]]; then
  echo "Missing planning prompt in one-shot event payload" >&2
  exit 1
fi

implementation_template=$(jq -r '.prompts.implementation // empty' "$EVENT_PATH")
if [[ -z "$implementation_template" || "$implementation_template" == "null" ]]; then
  echo "Missing implementation prompt in one-shot event payload" >&2
  exit 1
fi

issue_repo=$(jq -r '.repository // empty' "$EVENT_PATH")
if [[ -z "$issue_repo" || "$issue_repo" == "null" ]]; then
  echo "Missing repository metadata in event payload" >&2
  exit 1
fi

issue_number=$(jq -r '.issueNumber // empty' "$EVENT_PATH")
if [[ -z "$issue_number" || "$issue_number" == "null" ]]; then
  echo "Missing issue number metadata in event payload" >&2
  exit 1
fi

issue_title=$(jq -r '.issueTitle // empty' "$EVENT_PATH")
if [[ "$issue_title" == "null" ]]; then
  issue_title=""
fi

base_branch=$(jq -r '.base // empty' "$EVENT_PATH")
if [[ "$base_branch" == "null" ]]; then
  base_branch=""
fi

head_branch=$(jq -r '.head // empty' "$EVENT_PATH")
if [[ "$head_branch" == "null" ]]; then
  head_branch=""
fi

WORKTREE=${WORKTREE:-/workspace/lab}
PLAN_OUTPUT_PATH=${PLAN_OUTPUT_PATH:-${WORKTREE}/.codex-one-shot-plan.md}

rm -f "$PLAN_OUTPUT_PATH"
mkdir -p "$(dirname "$PLAN_OUTPUT_PATH")"

export CODEX_PROMPT="$planning_prompt"
export ISSUE_REPO="$issue_repo"
export ISSUE_NUMBER="$issue_number"
export WORKTREE
export PLAN_OUTPUT_PATH

if [[ -n "$base_branch" ]]; then
  export BASE_BRANCH="$base_branch"
else
  export BASE_BRANCH=${BASE_BRANCH:-main}
fi

if [[ -n "$head_branch" ]]; then
  export HEAD_BRANCH="$head_branch"
fi

if [[ -n "$issue_title" ]]; then
  export ISSUE_TITLE=${ISSUE_TITLE:-$issue_title}
fi

echo "Running Codex one-shot planning for ${ISSUE_REPO}#${ISSUE_NUMBER}" >&2
codex-plan.sh

if [[ ! -s "$PLAN_OUTPUT_PATH" ]]; then
  echo "Codex plan output file '$PLAN_OUTPUT_PATH' is missing or empty" >&2
  exit 1
fi

plan_body=$(cat "$PLAN_OUTPUT_PATH")

implementation_prompt=$(jq -r --arg placeholder "$PLACEHOLDER" --arg plan "$plan_body" '
  (.prompts.implementation // "") | gsub($placeholder; $plan)
' "$EVENT_PATH")

if [[ -z "$implementation_prompt" ]]; then
  echo "Failed to derive implementation prompt from one-shot event payload" >&2
  exit 1
fi

if [[ "$implementation_prompt" == *"$PLACEHOLDER"* ]]; then
  echo "Warning: implementation prompt still contains placeholder; continuing with generated plan" >&2
  implementation_prompt=${implementation_prompt//"$PLACEHOLDER"/$plan_body}
fi

tmp_event=$(mktemp)
jq --arg stage "implementation" \
  --arg prompt "$implementation_prompt" \
  --arg plan "$plan_body" \
  '.stage = $stage | .prompt = $prompt | .planCommentBody = $plan | del(.prompts)' \
  "$EVENT_PATH" >"$tmp_event"
mv "$tmp_event" "$EVENT_PATH"

echo "One-shot planning complete; invoking implementation stage" >&2
codex-implement.sh "$EVENT_PATH"

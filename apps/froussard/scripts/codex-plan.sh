#!/usr/bin/env bash
set -euo pipefail

: "${CODEX_PROMPT:?CODEX_PROMPT environment variable is required}"
OUTPUT_PATH=${OUTPUT_PATH:-/workspace/lab/.codex-plan-output.md}
POST_TO_GITHUB=${POST_TO_GITHUB:-false}
ISSUE_REPO=${ISSUE_REPO:-gregkonush/lab}
ISSUE_NUMBER=${ISSUE_NUMBER:-}

printf '%s
' "$CODEX_PROMPT" > /tmp/codex-prompt.txt

codex exec --dangerously-bypass-approvals-and-sandbox - < /tmp/codex-prompt.txt > "$OUTPUT_PATH"

if [[ "$POST_TO_GITHUB" == "true" ]]; then
  if [[ -z "$ISSUE_NUMBER" ]]; then
    echo "ISSUE_NUMBER must be set when POST_TO_GITHUB=true" >&2
    exit 1
  fi
  gh issue comment "$ISSUE_REPO" "$ISSUE_NUMBER" --body-file "$OUTPUT_PATH"
fi

echo "Codex plan written to $OUTPUT_PATH"

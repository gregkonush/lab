#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE' >&2
Usage: codex-post-run.sh <transcript-path> <stage> <exit-code> [attempt-label]

Summarises a Codex transcript by piping a trimmed log excerpt into `codex exec`.
Writes the generated summary to stdout and to ${WORKTREE}/.codex-<stage>-summary.md
unless SUMMARY_PATH is provided.
USAGE
}

TRANSCRIPT_PATH=${1:-}
STAGE=${2:-}
EXIT_CODE_RAW=${3:-}
ATTEMPT_LABEL=${4:-}

if [[ -z "$TRANSCRIPT_PATH" || -z "$STAGE" || -z "$EXIT_CODE_RAW" ]]; then
  usage
  exit 1
fi

if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "Transcript path not found: $TRANSCRIPT_PATH" >&2
  exit 1
fi

if ! [[ "$EXIT_CODE_RAW" =~ ^-?[0-9]+$ ]]; then
  echo "Exit code must be an integer, received '$EXIT_CODE_RAW'" >&2
  exit 1
fi
EXIT_CODE=$EXIT_CODE_RAW

if ! command -v codex >/dev/null 2>&1; then
  echo "codex CLI is required but not found in PATH" >&2
  exit 1
fi

WORKTREE=${WORKTREE:-/workspace/lab}

DEFAULT_SUMMARY_PATH="${WORKTREE}/.codex-${STAGE}-summary.md"
SUMMARY_PATH=${SUMMARY_PATH:-$DEFAULT_SUMMARY_PATH}
mkdir -p "$(dirname "$SUMMARY_PATH")"

MAX_BYTES_DEFAULT=60000
MAX_BYTES_ENV=${CODEX_POST_RUN_MAX_BYTES:-${CODEX_SUMMARY_MAX_CHARS:-}}
if [[ -n "$MAX_BYTES_ENV" && "$MAX_BYTES_ENV" =~ ^[0-9]+$ ]]; then
  MAX_BYTES=$MAX_BYTES_ENV
else
  MAX_BYTES=$MAX_BYTES_DEFAULT
fi
if ! [[ "$MAX_BYTES" =~ ^[0-9]+$ ]]; then
  MAX_BYTES=$MAX_BYTES_DEFAULT
fi

PROMPT_TEMPLATE=${CODEX_POST_RUN_PROMPT:-}

trimmed_transcript=$(TRANSCRIPT_PATH="$TRANSCRIPT_PATH" MAX_BYTES="$MAX_BYTES" python3 - <<'PY' 2>/dev/null || true
import os
import sys

path = os.environ['TRANSCRIPT_PATH']
max_bytes = int(os.environ['MAX_BYTES'])

try:
    with open(path, 'r', encoding='utf-8', errors='ignore') as fh:
        data = fh.read()
except FileNotFoundError:
    sys.exit(1)

if len(data.encode('utf-8')) <= max_bytes:
    print(data.strip())
else:
    encoded = data.encode('utf-8')
    trimmed = encoded[-max_bytes:]
    text = trimmed.decode('utf-8', errors='ignore')
    print("…(truncated log)…\n" + text.strip())
PY
)

if [[ -z "$trimmed_transcript" ]]; then
  echo "Transcript at $TRANSCRIPT_PATH is empty; skipping summary generation" >&2
  : >"$SUMMARY_PATH"
  exit 0
fi

if [[ -n "$PROMPT_TEMPLATE" ]]; then
  summarisation_prompt="$PROMPT_TEMPLATE"
else
  exit_label="success"
  if [[ "$EXIT_CODE" -ne 0 ]]; then
    exit_label="failure (exit $EXIT_CODE)"
  fi
  attempt_line=""
  if [[ -n "$ATTEMPT_LABEL" ]]; then
    attempt_line=$'\n'"- Attempt: ${ATTEMPT_LABEL}"
  fi
  summarisation_prompt=$(cat <<EOF
You are assisting with summarising Codex automation runs.

Provide a concise Markdown summary with:
- Result (success/failure) and any notable errors or TODOs.
- Recommended follow-up or retry guidance.
- Key files touched or commands executed, when identifiable.

Keep it under ~180 words. Use bullet lists when enumerating items.

Run details:
- Stage: ${STAGE}
- Exit status: ${exit_label}${attempt_line}

Transcript:
EOF
)
fi

tmp_summary=$(mktemp)
tmp_output=$(mktemp)
trap 'rm -f "$tmp_summary" "$tmp_output"' EXIT

if ! printf '%s\n\n%s\n' "$summarisation_prompt" "$trimmed_transcript" \
  | codex exec --dangerously-bypass-approvals-and-sandbox --output-last-message "$tmp_summary" - \
    >"$tmp_output" 2>&1; then
  cat "$tmp_output" >&2
  echo "codex exec failed during summary generation" >&2
  exit 1
fi

summary=$(sed 's/\r$//' "$tmp_summary")

if [[ -z "$summary" ]]; then
  echo "codex summary is empty; transcript may be unsuitable" >&2
  : >"$SUMMARY_PATH"
  exit 0
fi

printf '%s\n' "$summary" | tee "$SUMMARY_PATH"

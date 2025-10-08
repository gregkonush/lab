#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: codex-post-run.sh <transcript-path> <stage> <exit-code> [attempt-label]

Generates a post-run summary by prompting Codex with metadata and a trimmed
section of the run transcript. Prints the summary to stdout and writes it to
${WORKTREE:-/workspace/lab}/.codex-<stage>-summary.md (override via SUMMARY_PATH).
USAGE
}

if [[ $# -lt 3 ]]; then
  usage >&2
  exit 1
fi

TRANSCRIPT_PATH=$1
STAGE_RAW=$2
EXIT_CODE=$3
ATTEMPT_LABEL=${4:-}

if [[ ! -f "$TRANSCRIPT_PATH" ]]; then
  echo "Transcript not found at '$TRANSCRIPT_PATH'" >&2
  exit 1
fi

if ! [[ "$EXIT_CODE" =~ ^-?[0-9]+$ ]]; then
  echo "Exit code must be an integer, got '$EXIT_CODE'" >&2
  exit 1
fi

WORKTREE=${WORKTREE:-/workspace/lab}
SUMMARY_STAGE=$(printf '%s' "$STAGE_RAW" | tr '[:upper:]' '[:lower:]' | tr -cs 'a-z0-9-' '-')
SUMMARY_STAGE=${SUMMARY_STAGE:-run}
DEFAULT_SUMMARY_PATH="${WORKTREE}/.codex-${SUMMARY_STAGE}-summary.md"
SUMMARY_PATH=${SUMMARY_PATH:-$DEFAULT_SUMMARY_PATH}
mkdir -p "$(dirname "$SUMMARY_PATH")"

MAX_LINES=${CODEX_SUMMARY_MAX_LINES:-400}
MAX_CHARS=${CODEX_SUMMARY_MAX_CHARS:-16000}

ensure_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

ensure_command codex
ensure_command python3

SNIPPET_FILE=$(mktemp)

python3 - "$TRANSCRIPT_PATH" "$MAX_LINES" "$MAX_CHARS" >"$SNIPPET_FILE" <<'PY'
import re
import sys
from pathlib import Path

transcript = Path(sys.argv[1])
max_lines = int(sys.argv[2])
max_chars = int(sys.argv[3])

text = transcript.read_text(errors='replace')
lines = text.splitlines()

if max_lines > 0 and len(lines) > max_lines:
  lines = lines[-max_lines:]

snippet = "\n".join(lines)

if max_chars > 0 and len(snippet) > max_chars:
  snippet = snippet[-max_chars:]

ansi_re = re.compile(r'\x1B\[[0-?]*[ -/]*[@-~]')
snippet = ansi_re.sub('', snippet)

print(snippet)
PY

LOG_LEN=$(wc -c <"$SNIPPET_FILE" | tr -d '[:space:]')
LOG_LINES=$(wc -l <"$SNIPPET_FILE" | tr -d '[:space:]')

OUTCOME="failure"
if [[ "$EXIT_CODE" -eq 0 ]]; then
  OUTCOME="success"
fi

TIMESTAMP=$(date -u +'%Y-%m-%dT%H:%M:%SZ')

PROMPT=${CODEX_SUMMARY_PROMPT_OVERRIDE:-}
if [[ -z "$PROMPT" ]]; then
  PROMPT=$(STAGE="$SUMMARY_STAGE" EXIT_CODE="$EXIT_CODE" OUTCOME="$OUTCOME" TIMESTAMP="$TIMESTAMP" ATTEMPT_LABEL="$ATTEMPT_LABEL" LOG_LINES="$LOG_LINES" LOG_LEN="$LOG_LEN" python3 - <<'PY'
import json
import os
import sys

stage = os.environ['STAGE']
exit_code = int(os.environ['EXIT_CODE'])
outcome = os.environ['OUTCOME']
timestamp = os.environ['TIMESTAMP']
attempt = os.environ.get('ATTEMPT_LABEL', '').strip()
log_lines = int(os.environ['LOG_LINES'])
log_bytes = int(os.environ['LOG_LEN'])

sections = [
    "You are summarizing an automated Codex workflow run.",
    f"- Stage: {stage}",
    f"- Outcome: {outcome} (exit code {exit_code})",
    f"- Timestamp (UTC): {timestamp}",
    f"- Log excerpt: {log_lines} lines / {log_bytes} bytes (trailing portion of transcript)",
]

if attempt:
    sections.append(f"- Attempt: {attempt}")

instructions = """Produce concise Markdown with:
- **Outcome** line summarizing status and key signal.
- Bullet list of the most important actions or observations.
- \"Follow-ups\" subsection only when more work is required (otherwise omit).
- Avoid speculation; base statements strictly on the provided logs.
- Keep total length under 140 words."""

sections.append("")
sections.append(instructions)
sections.append("")
sections.append("Log excerpt follows between <log></log> tags.")
sections.append("<log>")

print("\n".join(sections))
PY
)
fi

SUMMARY_INPUT=$(mktemp)
cleanup() {
  rm -f "$SNIPPET_FILE" "$SUMMARY_INPUT"
}
trap cleanup EXIT

{
  printf '%s\n' "$PROMPT"
  cat "$SNIPPET_FILE"
  printf '\n</log>\n'
} >"$SUMMARY_INPUT"

set +e
codex exec --dangerously-bypass-approvals-and-sandbox --output-last-message "$SUMMARY_PATH" - <"$SUMMARY_INPUT" >/dev/null
CODEX_STATUS=$?
set -e

if [[ $CODEX_STATUS -ne 0 ]]; then
  echo "codex exec failed while generating post-run summary (exit $CODEX_STATUS)" >&2
  exit $CODEX_STATUS
fi

if [[ ! -s "$SUMMARY_PATH" ]]; then
  echo "Summary file not created at '$SUMMARY_PATH'" >&2
  exit 1
fi

cat "$SUMMARY_PATH"

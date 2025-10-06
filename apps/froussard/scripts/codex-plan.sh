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

if ! printf '%s' "$PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox - | tee "$OUTPUT_PATH"; then
  echo "Codex execution failed" >&2
  exit 1
fi

echo "Codex interaction logged to $OUTPUT_PATH"

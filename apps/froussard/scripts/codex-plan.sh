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
  printf '%s' "$PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox - | tee >("${relay_cmd[@]}" "${relay_args[@]}") "$OUTPUT_PATH"
  pipeline_status=$?
  pipe_statuses=("${PIPESTATUS[@]}")
  set -o pipefail
  set -e

  codex_status=${pipe_statuses[1]:-1}
  tee_status=${pipe_statuses[2]:-1}

  if [[ $codex_status -ne 0 ]]; then
    echo "Codex execution failed" >&2
    exit 1
  fi

  if [[ $pipeline_status -ne 0 && $tee_status -ne 0 ]]; then
    if ! cat "$OUTPUT_PATH" >/dev/null 2>&1; then
      echo "Codex execution failed: unable to persist output to $OUTPUT_PATH" >&2
      exit 1
    fi
    echo "Discord relay failed (status $tee_status); continuing without Discord mirror" >&2
  fi
else
  if ! printf '%s' "$PROMPT" | codex exec --dangerously-bypass-approvals-and-sandbox - | tee "$OUTPUT_PATH"; then
    echo "Codex execution failed" >&2
    exit 1
  fi
fi

echo "Codex interaction logged to $OUTPUT_PATH"

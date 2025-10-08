#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: upsert-plan-comment.sh [options]

Reads the Codex plan from a markdown file and upserts the corresponding
GitHub issue comment identified by the <!-- codex:plan --> marker.

Options:
  --plan-file <path>   Read the plan from the specified file (default: PLAN.md).
  --repo <owner/name>  Override ISSUE_REPO environment variable.
  --issue <number>     Override ISSUE_NUMBER environment variable.
  --marker <marker>    Override the marker string (default: <!-- codex:plan -->).
  --dry-run            Resolve target comment and print the payload without mutating GitHub.
  -h, --help           Show this help message.

Environment:
  ISSUE_REPO                 Repository in owner/name form (required unless --repo is provided).
  ISSUE_NUMBER               Issue number (required unless --issue is provided).
  PLAN_OUTPUT_PATH           Optional log file to append helper output.
  CODEX_PLAN_COMMENT_LOG     Optional log override (takes precedence over PLAN_OUTPUT_PATH).
  CODEX_PLAN_COMMENT_MARKER  Marker string to locate the plan comment (default: <!-- codex:plan -->).

The script prints the action ("create" or "update"), comment id, and comment URL.
Non-zero exits indicate failures (e.g., missing plan file, gh errors).
USAGE
}

ensure_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

log_message() {
  local message=$1
  local log_path=${CODEX_PLAN_COMMENT_LOG:-${PLAN_OUTPUT_PATH:-}}
  if [[ -n "$log_path" ]]; then
    mkdir -p "$(dirname "$log_path")"
    printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$message" >>"$log_path"
  fi
}

PLAN_FILE=${PLAN_FILE:-PLAN.md}
REPO_OVERRIDE=""
ISSUE_OVERRIDE=""
MARKER_OVERRIDE=""
DRY_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --plan-file)
      PLAN_FILE=${2:?Missing argument for --plan-file}
      shift 2
      ;;
    --repo)
      REPO_OVERRIDE=${2:?Missing argument for --repo}
      shift 2
      ;;
    --issue)
      ISSUE_OVERRIDE=${2:?Missing argument for --issue}
      shift 2
      ;;
    --marker)
      MARKER_OVERRIDE=${2:?Missing argument for --marker}
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ensure_command gh
ensure_command jq

if [[ ! -f "$PLAN_FILE" ]]; then
  echo "Plan file not found: $PLAN_FILE" >&2
  exit 1
fi

PLAN_BODY=$(cat "$PLAN_FILE")
PLAN_BODY=${PLAN_BODY//$'\r'/}

MARKER_DEFAULT='<!-- codex:plan -->'
MARKER=${MARKER_OVERRIDE:-${CODEX_PLAN_COMMENT_MARKER:-$MARKER_DEFAULT}}

if [[ "${PLAN_BODY}" != *"${MARKER}"* ]]; then
  echo "Plan file must include the marker '${MARKER}'" >&2
  exit 1
fi

REPO=${REPO_OVERRIDE:-${ISSUE_REPO:-}}
ISSUE_NUMBER=${ISSUE_OVERRIDE:-${ISSUE_NUMBER:-}}

if [[ -z "$REPO" || -z "$ISSUE_NUMBER" ]]; then
  echo "ISSUE_REPO and ISSUE_NUMBER must be provided via flags or environment variables" >&2
  exit 1
fi

log_message "upsert-plan start repo=${REPO} issue=${ISSUE_NUMBER} marker=${MARKER} dry_run=${DRY_RUN}"

existing_comments=$(gh api "repos/${REPO}/issues/${ISSUE_NUMBER}/comments" --paginate || true)
existing_comments=${existing_comments:-[]}

comment_id=$(printf '%s' "$existing_comments" | jq -r --arg marker "$MARKER" 'try (map(select(.body | contains($marker))) | last // empty | .id // empty) catch empty')
comment_url=$(printf '%s' "$existing_comments" | jq -r --arg marker "$MARKER" 'try (map(select(.body | contains($marker))) | last // empty | .html_url // empty) catch empty')

payload_file=$(mktemp)
trap 'rm -f "$payload_file"' EXIT
printf '{"body":%s}\n' "$(printf '%s' "$PLAN_BODY" | jq -Rs .)" >"$payload_file"

action="create"

if [[ -n "$comment_id" ]]; then
  action="update"
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  log_message "upsert-plan dry-run action=${action} comment_id=${comment_id:-"(new)"}"
else
  if [[ "$action" == "update" ]]; then
    response=$(gh api "repos/${REPO}/issues/comments/${comment_id}" --method PATCH --input "$payload_file")
  else
    response=$(gh api "repos/${REPO}/issues/${ISSUE_NUMBER}/comments" --method POST --input "$payload_file")
  fi

  comment_id=$(printf '%s' "$response" | jq -r '.id')
  comment_url=$(printf '%s' "$response" | jq -r '.html_url')
  updated_marker=$(printf '%s' "$response" | jq -r --arg marker "$MARKER" 'if (.body // "") | contains($marker) then 1 else 0 end')

  if [[ "$updated_marker" != "1" ]]; then
    echo "Updated comment missing marker; aborting" >&2
    exit 1
  fi

  log_message "upsert-plan action=${action} comment_id=${comment_id} comment_url=${comment_url}"
fi

echo "action=${action}"
echo "comment_id=${comment_id}"
echo "comment_url=${comment_url}"

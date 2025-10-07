#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: codex-progress-comment.sh [options]

Creates or updates the Codex implementation progress comment using the GitHub CLI.

Options:
  --body-file <path>  Read the comment body from the provided file instead of stdin.
  --repo <owner/name> Override ISSUE_REPO environment variable.
  --issue <number>    Override ISSUE_NUMBER environment variable.
  --marker <marker>   Override CODEX_PROGRESS_COMMENT_MARKER (default: <!-- codex:progress -->).
  --dry-run           Resolve the target comment and print the body without mutating GitHub.
  -h, --help          Show this help message.

Environment:
  ISSUE_REPO                       Repository in owner/name form (required unless --repo is provided).
  ISSUE_NUMBER                     Issue number (required unless --issue is provided).
  CODEX_PROGRESS_COMMENT_MARKER    Marker string inserted into the progress comment (default: <!-- codex:progress -->).
  CODEX_PROGRESS_COMMENT_LOG_PATH  Optional file to append helper output (falls back to OUTPUT_PATH).
  OUTPUT_PATH                      Optional log file (e.g., .codex-implementation.log).

Provide the comment body via stdin or --body-file. The script ensures the marker is present,
upserts the matching issue comment, and prints the resulting comment id and url.
USAGE
}

ensure_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

append_log() {
  local message=$1
  local log_path=${CODEX_PROGRESS_COMMENT_LOG_PATH:-${OUTPUT_PATH:-}}
  if [[ -n "$log_path" ]]; then
    mkdir -p "$(dirname "$log_path")"
    printf '%s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$message" >>"$log_path"
  fi
}

BODY_FILE=""
DRY_RUN=0
REPO_OVERRIDE=""
ISSUE_OVERRIDE=""
MARKER_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --body-file)
      BODY_FILE=${2:?Missing argument for --body-file}
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

DEFAULT_MARKER='<!-- codex:progress -->'
MARKER=${MARKER_OVERRIDE:-${CODEX_PROGRESS_COMMENT_MARKER:-$DEFAULT_MARKER}}

if [[ -n "$BODY_FILE" ]]; then
  if [[ ! -f "$BODY_FILE" ]]; then
    echo "Body file not found: $BODY_FILE" >&2
    exit 1
  fi
  COMMENT_BODY=$(cat "$BODY_FILE")
else
  if ! test -t 0; then
    COMMENT_BODY=$(cat)
  else
    echo "Comment body must be provided via stdin or --body-file" >&2
    exit 1
  fi
fi

COMMENT_BODY=${COMMENT_BODY//$'\r'/}

if [[ -z "$COMMENT_BODY" ]]; then
  echo "Comment body cannot be empty" >&2
  exit 1
fi

if [[ "${COMMENT_BODY}" != *"${MARKER}"* ]]; then
  echo "Comment body must include the marker '${MARKER}'" >&2
  exit 1
fi

REPO=${REPO_OVERRIDE:-${ISSUE_REPO:-}}
ISSUE_NUMBER=${ISSUE_OVERRIDE:-${ISSUE_NUMBER:-}}

if [[ -z "$REPO" || -z "$ISSUE_NUMBER" ]]; then
  echo "ISSUE_REPO and ISSUE_NUMBER must be provided via flags or environment variables" >&2
  exit 1
fi

append_log "codex-progress-comment start repo=${REPO} issue=${ISSUE_NUMBER} marker=${MARKER} dry_run=${DRY_RUN}"

existing_comment_json=$(gh api "repos/${REPO}/issues/${ISSUE_NUMBER}/comments" --paginate || true)
existing_comment_json=${existing_comment_json:-[]}
existing_comment_id=$(printf '%s' "$existing_comment_json" | jq -r --arg marker "$MARKER" 'try (map(select(.body | contains($marker))) | last // empty | .id // empty) catch empty')
existing_comment_url=$(printf '%s' "$existing_comment_json" | jq -r --arg marker "$MARKER" 'try (map(select(.body | contains($marker))) | last // empty | .html_url // empty) catch empty')

payload_file=$(mktemp)
trap 'rm -f "$payload_file"' EXIT
printf '{"body":%s}\n' "$(printf '%s' "$COMMENT_BODY" | jq -Rs .)" >"$payload_file"

action="create"
comment_id=""
comment_url=""
marker_present=1

if [[ -n "$existing_comment_id" ]]; then
  action="update"
  comment_id=$existing_comment_id
  comment_url=$existing_comment_url
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  append_log "codex-progress-comment dry-run action=${action} comment_id=${comment_id:-"(new)"}"
else
  if [[ "$action" == "update" ]]; then
    response=$(gh api "repos/${REPO}/issues/comments/${existing_comment_id}" --method PATCH --input "$payload_file")
  else
    response=$(gh api "repos/${REPO}/issues/${ISSUE_NUMBER}/comments" --method POST --input "$payload_file")
  fi

  comment_id=$(printf '%s' "$response" | jq -r '.id')
  comment_url=$(printf '%s' "$response" | jq -r '.html_url')
  marker_present=$(printf '%s' "$response" | jq -r --arg marker "$MARKER" 'if (.body // "") | contains($marker) then 1 else 0 end')

  append_log "codex-progress-comment action=${action} comment_id=${comment_id} comment_url=${comment_url} marker_present=${marker_present}"
fi

echo "action=${action}"
echo "comment_id=${comment_id}"
echo "comment_url=${comment_url}"
echo "marker_present=${marker_present}"

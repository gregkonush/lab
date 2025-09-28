#!/usr/bin/env bash
set -euo pipefail

DEFAULT_WORKSPACE="proompteng"
DEFAULT_LOCAL_AUTH="$HOME/.codex/auth.json"
DEFAULT_LOCAL_CONFIG="$HOME/.codex/config.toml"
DEFAULT_REMOTE_AUTH='~/.codex/auth.json'
DEFAULT_REMOTE_CONFIG='~/.codex/config.toml'
DEFAULT_REMOTE_HOME='/home/coder'

usage() {
  cat <<'USAGE'
Usage: sync-codex-cli.sh [options]

Options:
  -w, --workspace NAME     Coder workspace name (default: proompteng)
  -a, --auth PATH          Local auth.json path (default: ~/.codex/auth.json)
  -c, --config PATH        Local config template path (default: ~/.codex/config.toml)
      --remote-auth PATH   Remote auth destination (default: ~/.codex/auth.json)
      --remote-config PATH Remote config destination (default: ~/.codex/config.toml)
      --remote-home PATH   Remote home directory (default: /home/coder)
      --remote-repo PATH   Remote repo directory (default: <remote-home>/github.com/lab)
  -h, --help               Show this help message and exit
USAGE
}

shell_escape() {
  printf '%q' "$1"
}

workspace="$DEFAULT_WORKSPACE"
local_auth="$DEFAULT_LOCAL_AUTH"
local_config="$DEFAULT_LOCAL_CONFIG"
remote_auth="$DEFAULT_REMOTE_AUTH"
remote_config="$DEFAULT_REMOTE_CONFIG"
remote_home="$DEFAULT_REMOTE_HOME"
remote_repo=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -w|--workspace)
      workspace="$2"
      shift 2
      ;;
    -a|--auth)
      local_auth="$2"
      shift 2
      ;;
    -c|--config)
      local_config="$2"
      shift 2
      ;;
    --remote-auth)
      remote_auth="$2"
      shift 2
      ;;
    --remote-config)
      remote_config="$2"
      shift 2
      ;;
    --remote-home)
      remote_home="$2"
      shift 2
      ;;
    --remote-repo)
      remote_repo="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$local_auth" ]]; then
  echo "Missing local auth file: $local_auth" >&2
  exit 1
fi

if [[ ! -f "$local_config" ]]; then
  echo "Missing local config template: $local_config" >&2
  exit 1
fi

if ! command -v coder >/dev/null 2>&1; then
  echo "coder CLI not found in PATH" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required" >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "OpenSSH ssh client is required" >&2
  exit 1
fi

if [[ -z "$remote_repo" ]]; then
  remote_repo="${remote_home%/}/github.com/lab"
fi

remote_auth_dir="${remote_auth%/*}"
if [[ "$remote_auth_dir" == "$remote_auth" ]]; then
  echo "Unable to determine remote directory from auth target: $remote_auth" >&2
  exit 1
fi

remote_config_dir="${remote_config%/*}"
if [[ "$remote_config_dir" == "$remote_config" ]]; then
  echo "Unable to determine remote directory from config target: $remote_config" >&2
  exit 1
fi

echo "Preparing to sync Codex CLI files to workspace '$workspace'"

coder_host="coder.${workspace}"
if ! ssh -G "$coder_host" >/dev/null 2>&1; then
  echo "SSH host entry '$coder_host' not found. Run 'coder config-ssh --yes' to configure SSH access." >&2
  exit 1
fi

ssh_opts=(-o BatchMode=yes -o ConnectTimeout=10)

init_cmd="set -euo pipefail; mkdir -p $(shell_escape "$remote_auth_dir") $(shell_escape "$remote_config_dir"); rm -f $(shell_escape "$remote_auth") $(shell_escape "$remote_config")"
ssh "${ssh_opts[@]}" "$coder_host" "$init_cmd"

echo "Copying auth.json to $(shell_escape "$workspace:$remote_auth")"
RSYNC_RSH="ssh -o BatchMode=yes -o ConnectTimeout=10" rsync -av --progress "$local_auth" "$coder_host:$remote_auth"

ssh "${ssh_opts[@]}" "$coder_host" "chmod 600 $(shell_escape "$remote_auth")"

tmp_config=""
trap 'if [[ -n "$tmp_config" && -f "$tmp_config" ]]; then rm -f "$tmp_config"; fi' EXIT

local_home="$(cd "$HOME" && pwd)"
local_repo="${local_home%/}/github.com/lab"
remote_default_repo="${remote_home%/}/github.com/lab"
remote_config_payload=$(cat "$local_config")
remote_config_payload=${remote_config_payload//$'\r'/}
remote_config_payload=${remote_config_payload//"$local_repo"/"$remote_repo"}
remote_config_payload=${remote_config_payload//"$local_home"/"$remote_home"}
if [[ "$remote_repo" != "$remote_default_repo" ]]; then
  remote_config_payload=${remote_config_payload//"$remote_default_repo"/"$remote_repo"}
fi
if [[ "$remote_config_payload" != *$'\n' ]]; then
  remote_config_payload+=$'\n'
fi

tmp_config=$(mktemp)
printf '%s' "$remote_config_payload" >"$tmp_config"

echo "Copying config.toml to $(shell_escape "$workspace:$remote_config")"
RSYNC_RSH="ssh -o BatchMode=yes -o ConnectTimeout=10" rsync -av --progress "$tmp_config" "$coder_host:$remote_config"

ssh "${ssh_opts[@]}" "$coder_host" "chmod 600 $(shell_escape "$remote_config")"

ssh "${ssh_opts[@]}" "$coder_host" bash -s <<'REMOTE'
set -euo pipefail
codex_marker="# Managed by sync-codex-cli codex wrapper"
codex_function=$'codex() {\n  command codex --dangerously-bypass-approvals-and-sandbox --search --model gpt-5-codex "$@"\n}'
for rc in ~/.profile ~/.bashrc ~/.zshrc; do
  touch "${rc}"
  tmp="$(mktemp)"
  sed -e '/^alias codex=.*/d' -e '/shopt -s expand_aliases/d' "${rc}" > "${tmp}"
  mv "${tmp}" "${rc}"
  if ! grep -F "${codex_marker}" "${rc}" >/dev/null 2>&1; then
    printf '\n%s\n%s\n' "${codex_marker}" "${codex_function}" >> "${rc}"
  fi
done
REMOTE

echo "Codex auth, config, and wrapper synced to $workspace"

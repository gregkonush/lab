#!/usr/bin/env bash
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/gregkonush/lab}
WORKTREE_DEFAULT=${WORKTREE:-/workspace/lab}
TARGET_DIR=${TARGET_DIR:-$WORKTREE_DEFAULT}
BASE_BRANCH=${BASE_BRANCH:-main}
HEAD_BRANCH=${HEAD_BRANCH:-}

export WORKTREE="$WORKTREE_DEFAULT"
export TARGET_DIR BASE_BRANCH HEAD_BRANCH

mkdir -p "$(dirname "$TARGET_DIR")"

if [[ -d "$TARGET_DIR/.git" ]]; then
  pushd "$TARGET_DIR" >/dev/null
  git fetch --all --prune
  git reset --hard "origin/${BASE_BRANCH}"
  popd >/dev/null
else
  rm -rf "$TARGET_DIR"
  gh repo clone "$REPO_URL" "$TARGET_DIR"
  pushd "$TARGET_DIR" >/dev/null
  git checkout "$BASE_BRANCH"
  popd >/dev/null
fi

cd "$TARGET_DIR"

if command -v pnpm >/dev/null 2>&1 && [[ -f pnpm-lock.yaml || -f pnpm-workspace.yaml ]]; then
  pnpm install --frozen-lockfile
fi

exec "$@"

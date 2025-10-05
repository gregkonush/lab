#!/usr/bin/env bash
set -euo pipefail

REPO_URL=${REPO_URL:-https://github.com/gregkonush/lab}
BASE_BRANCH=${BASE_BRANCH:-main}
TARGET_DIR=${TARGET_DIR:-/workspace/lab}

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
exec "$@"

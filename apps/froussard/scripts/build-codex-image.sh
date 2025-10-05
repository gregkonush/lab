#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../../.." && pwd)"
DOCKERFILE="$ROOT_DIR/apps/froussard/Dockerfile.codex"
IMAGE_TAG=${IMAGE_TAG:-registry.ide-newton.ts.net/lab/codex-universal:latest}
CONTEXT_DIR=${CONTEXT_DIR:-$ROOT_DIR}
CODEX_AUTH=${CODEX_AUTH:-$HOME/.codex/auth.json}
CODEX_CONFIG=${CODEX_CONFIG:-$HOME/.codex/config.toml}

if [[ ! -f "$DOCKERFILE" ]]; then
  echo "Dockerfile not found at $DOCKERFILE" >&2
  exit 1
fi

if [[ ! -f "$CODEX_AUTH" ]]; then
  echo "Missing Codex auth file: $CODEX_AUTH" >&2
  exit 1
fi

if [[ ! -f "$CODEX_CONFIG" ]]; then
  echo "Missing Codex config file: $CODEX_CONFIG" >&2
  exit 1
fi

GH_TOKEN_FILE=""
cleanup() {
  if [[ -n "$GH_TOKEN_FILE" && -f "$GH_TOKEN_FILE" ]]; then
    rm -f "$GH_TOKEN_FILE"
  fi
}
trap cleanup EXIT

if [[ -n "${GH_TOKEN:-}" ]]; then
  GH_TOKEN_FILE=$(mktemp)
  printf '%s' "$GH_TOKEN" > "$GH_TOKEN_FILE"
else
  if command -v gh >/dev/null 2>&1; then
    TOKEN=$(gh auth token 2>/dev/null || true)
    if [[ -z "$TOKEN" ]]; then
      echo "Set GH_TOKEN environment variable or login with 'gh auth login'." >&2
      exit 1
    fi
    GH_TOKEN_FILE=$(mktemp)
    printf '%s' "$TOKEN" > "$GH_TOKEN_FILE"
  else
    echo "gh CLI not found; please install gh or export GH_TOKEN." >&2
    exit 1
  fi
fi

export DOCKER_BUILDKIT=1

echo "Building $IMAGE_TAG from $DOCKERFILE"
docker build \
  -f "$DOCKERFILE" \
  --secret id=codex_auth,src="$CODEX_AUTH" \
  --secret id=codex_config,src="$CODEX_CONFIG" \
  --secret id=github_token,src="$GH_TOKEN_FILE" \
  -t "$IMAGE_TAG" \
  "$CONTEXT_DIR"

echo "Pushing $IMAGE_TAG"
docker push "$IMAGE_TAG"

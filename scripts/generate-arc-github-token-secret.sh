#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

if [[ "${1:-}" == -* ]]; then
  echo "Unknown flag '$1'. Pass an optional output path or nothing." >&2
  exit 1
fi

OUTPUT_PATH="${1:-$REPO_ROOT/argocd/applications/arc/github-token.yaml}"

DEFAULT_OP_GITHUB_TOKEN_PATH='op://infra/github personal token/token'
OP_GITHUB_TOKEN_PATH="${ARC_GITHUB_TOKEN_OP_PATH:-$DEFAULT_OP_GITHUB_TOKEN_PATH}"

SEALED_CONTROLLER_NAME="${ARC_SEALED_CONTROLLER_NAME:-sealed-secrets}"
SEALED_CONTROLLER_NAMESPACE="${ARC_SEALED_CONTROLLER_NAMESPACE:-sealed-secrets}"

SECRET_NAME="github-token"
SECRET_NAMESPACE="arc"
SECRET_KEY="github_token"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required CLI '$1' is not available in PATH" >&2
    exit 1
  fi
}

require op
require kubectl
require kubeseal

GITHUB_TOKEN="$(op read "$OP_GITHUB_TOKEN_PATH" | tr -d '\r\n')"

if [[ -z "$GITHUB_TOKEN" ]]; then
  echo "GitHub token is empty. Check 1Password path: $OP_GITHUB_TOKEN_PATH" >&2
  exit 1
fi

TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

if ! kubectl create secret generic "$SECRET_NAME" \
  --namespace "$SECRET_NAMESPACE" \
  --from-literal="$SECRET_KEY=$GITHUB_TOKEN" \
  --dry-run=client -o yaml |
  kubeseal \
    --controller-name "$SEALED_CONTROLLER_NAME" \
    --controller-namespace "$SEALED_CONTROLLER_NAMESPACE" \
    --format yaml >"$TMP_OUTPUT"; then
  echo "Failed to generate sealed secret" >&2
  exit 1
fi

if ! grep -q "$SECRET_KEY:" "$TMP_OUTPUT"; then
  echo "kubeseal output missing expected encrypted field '$SECRET_KEY'" >&2
  exit 1
fi

install -m 600 "$TMP_OUTPUT" "$OUTPUT_PATH"

echo "SealedSecret written to $OUTPUT_PATH. Commit and sync arc to roll out the new token."

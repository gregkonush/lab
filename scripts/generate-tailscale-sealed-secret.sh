#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"

if [[ "${1:-}" == -* ]]; then
  echo "Unknown flag '$1'. Pass an optional output path or nothing." >&2
  exit 1
fi

OUTPUT_PATH="${1:-$REPO_ROOT/argocd/applications/tailscale/base/secrets.yaml}"

OP_CLIENT_ID_PATH="${TAILSCALE_OP_CLIENT_ID_PATH:-op://infra/tailscale operator/client_id}"
OP_CLIENT_SECRET_PATH="${TAILSCALE_OP_CLIENT_SECRET_PATH:-op://infra/tailscale operator/client_secret}"

SEALED_CONTROLLER_NAME="${TAILSCALE_SEALED_CONTROLLER_NAME:-sealed-secrets}"
SEALED_CONTROLLER_NAMESPACE="${TAILSCALE_SEALED_CONTROLLER_NAMESPACE:-sealed-secrets}"

SECRET_NAME="operator-oauth-token"
SECRET_NAMESPACE="tailscale"

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required CLI '$1' is not available in PATH" >&2
    exit 1
  fi
}

require op
require kubectl
require kubeseal

CLIENT_ID="$(op read "$OP_CLIENT_ID_PATH" | tr -d '\r\n')"
CLIENT_SECRET="$(op read "$OP_CLIENT_SECRET_PATH" | tr -d '\r\n')"

if [[ -z "$CLIENT_ID" ]]; then
  echo "Client ID is empty. Check 1Password path: $OP_CLIENT_ID_PATH" >&2
  exit 1
fi

if [[ -z "$CLIENT_SECRET" ]]; then
  echo "Client secret is empty. Check 1Password path: $OP_CLIENT_SECRET_PATH" >&2
  exit 1
fi

TMP_OUTPUT="$(mktemp)"
trap 'rm -f "$TMP_OUTPUT"' EXIT

if ! kubectl create secret generic "$SECRET_NAME" \
  --namespace "$SECRET_NAMESPACE" \
  --from-literal=client_id="$CLIENT_ID" \
  --from-literal=client_secret="$CLIENT_SECRET" \
  --dry-run=client -o yaml |
  kubeseal \
    --controller-name "$SEALED_CONTROLLER_NAME" \
    --controller-namespace "$SEALED_CONTROLLER_NAMESPACE" \
    --format yaml >"$TMP_OUTPUT"; then
  echo "Failed to generate sealed secret" >&2
  exit 1
fi

if ! grep -q "client_id:" "$TMP_OUTPUT" || ! grep -q "client_secret:" "$TMP_OUTPUT"; then
  echo "kubeseal output missing expected encrypted fields" >&2
  exit 1
fi

install -m 600 "$TMP_OUTPUT" "$OUTPUT_PATH"

echo "SealedSecret written to $OUTPUT_PATH. Commit and trigger an Argo CD sync to roll it out."

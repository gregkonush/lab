#!/usr/bin/env bash
set -euo pipefail

# Generates new credentials for the dernier Rails service, seals them, and writes
# the manifest over the existing sealed secret so it can be synced back to the cluster.

usage() {
  cat <<'EOF'
Usage: scripts/generate-dernier-sealed-secret.sh [options]

Options:
  --output <path>             Override output manifest path.
  --controller-name <name>    Sealed Secrets controller name (default: sealed-secrets).
  --controller-namespace <ns> Sealed Secrets controller namespace (default: sealed-secrets).
  --rails-master-key <value>  Provide an explicit RAILS_MASTER_KEY instead of generating one.
  --secret-key-base <value>   Provide an explicit SECRET_KEY_BASE instead of generating one.
  --print-values              Echo generated credential values (handle carefully).
  -h, --help                  Show this help message.

Environment overrides:
  SEALED_SECRETS_CONTROLLER_NAME
  SEALED_SECRETS_CONTROLLER_NAMESPACE
  DERNIER_SEALED_SECRET_OUTPUT
EOF
}

fatal() {
  echo "Error: $*" >&2
  exit 1
}

require_cli() {
  local cli=$1
  if ! command -v "$cli" >/dev/null 2>&1; then
    fatal "Required CLI '$cli' is not available in PATH"
  fi
}

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

namespace=dernier
secret_name=dernier-secrets
output_path="${DERNIER_SEALED_SECRET_OUTPUT:-$repo_root/argocd/applications/dernier/overlays/cluster/sealed-secret.yaml}"
controller_name="${SEALED_SECRETS_CONTROLLER_NAME:-sealed-secrets}"
controller_namespace="${SEALED_SECRETS_CONTROLLER_NAMESPACE:-sealed-secrets}"
rails_master_key=""
secret_key_base=""
print_values=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      [[ $# -lt 2 ]] && fatal "--output requires a value"
      output_path="$2"
      shift 2
      ;;
    --controller-name)
      [[ $# -lt 2 ]] && fatal "--controller-name requires a value"
      controller_name="$2"
      shift 2
      ;;
    --controller-namespace)
      [[ $# -lt 2 ]] && fatal "--controller-namespace requires a value"
      controller_namespace="$2"
      shift 2
      ;;
    --rails-master-key)
      [[ $# -lt 2 ]] && fatal "--rails-master-key requires a value"
      rails_master_key="$2"
      shift 2
      ;;
    --secret-key-base)
      [[ $# -lt 2 ]] && fatal "--secret-key-base requires a value"
      secret_key_base="$2"
      shift 2
      ;;
    --print-values)
      print_values=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fatal "Unknown argument '$1'"
      ;;
  esac
done

require_cli kubectl
require_cli kubeseal

if [[ -z $rails_master_key ]]; then
  require_cli openssl
  rails_master_key="$(openssl rand -hex 16 | tr -d '\n')"
fi

if [[ -z $secret_key_base ]]; then
  require_cli openssl
  secret_key_base="$(openssl rand -hex 64)"
fi

if $print_values; then
  cat <<EOF
RAILS_MASTER_KEY=$rails_master_key
SECRET_KEY_BASE=$secret_key_base
EOF
fi

mkdir -p "$(dirname "$output_path")"
tmp_output="$(mktemp "${TMPDIR:-/tmp}/dernier-sealed-secret.XXXXXX")"
trap 'rm -f "$tmp_output"' EXIT

kubectl create secret generic "$secret_name" \
  --namespace "$namespace" \
  --dry-run=client \
  -o yaml \
  --from-literal="RAILS_MASTER_KEY=$rails_master_key" \
  --from-literal="SECRET_KEY_BASE=$secret_key_base" \
  | kubeseal \
      --controller-name="$controller_name" \
      --controller-namespace="$controller_namespace" \
      --format=yaml \
  > "$tmp_output"

mv "$tmp_output" "$output_path"
trap - EXIT

echo "Sealed secret written to $output_path" >&2

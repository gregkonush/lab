#!/usr/bin/env bash
set -euo pipefail

# Usage: seal-generic-secret.sh <namespace> <name> <output-file> key=value [key=value...]
# Creates a generic secret from literal key/value pairs and seals it with kubeseal.

if [[ $# -lt 4 ]]; then
  echo "Usage: $0 <namespace> <name> <output-file> key=value [key=value...]" >&2
  exit 1
fi

namespace=$1
name=$2
output=$3
shift 3

args=(kubectl create secret generic "$name" --namespace "$namespace" --dry-run=client -o yaml)
for literal in "$@"; do
  if [[ $literal != *=* ]]; then
    echo "Invalid literal '$literal'; expected key=value" >&2
    exit 1
  fi
  args+=(--from-literal="$literal")
done

"${args[@]}" \
  | kubeseal \
      --controller-name=sealed-secrets \
      --controller-namespace=sealed-secrets \
      --format=yaml \
  > "$output"

echo "Sealed secret written to $output" >&2

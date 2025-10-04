#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-argocd}"

if ! command -v kubeconform >/dev/null 2>&1; then
  echo "kubeconform is required but not installed" >&2
  exit 1
fi

# Collect YAML files. If none found, exit successfully.
if ! find "$ROOT_DIR" -type f -name '*.yaml' -print -quit >/dev/null; then
  echo "No YAML manifests found under $ROOT_DIR" >&2
  exit 0
fi

find "$ROOT_DIR" -type f -name '*.yaml' -print0 \
  | xargs -0 kubeconform --strict --summary --ignore-missing-schemas

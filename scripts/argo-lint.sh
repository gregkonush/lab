#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$(pwd)}"
FOUND=0
STATUS=0

while IFS= read -r -d '' file; do
  if grep -Eq '^(kind|  kind):\s*(Workflow|WorkflowTemplate|CronWorkflow)' "$file"; then
    FOUND=1
    echo "::group::argo lint $file"
    if ! argo lint --offline "$file"; then
      STATUS=1
    fi
    echo "::endgroup::"
  fi
done < <(find "$ROOT_DIR" -type f -name '*.yaml' -print0)

if [[ "$FOUND" -eq 0 ]]; then
  echo "No Argo Workflow manifests detected under $ROOT_DIR" >&2
fi

exit "$STATUS"

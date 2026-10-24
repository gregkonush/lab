#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
for application in opencode bayn; do
  # These are manifest fixtures only; the repository checkout is untouched.
  mkdir -p "$fixture/$application"
  cp -R "$root/argocd/applications/$application/." "$fixture/$application/"
  for marker in a b; do
    digest="$(printf '%064s' '' | tr ' ' "$marker")"
    (
      cd "$fixture/$application"
      kustomize edit set image "$application-main=registry.ide-newton.ts.net/lab/$application@sha256:$digest"
      kustomize build .
    ) > "$fixture/$application-$marker.yaml"
    yq eval-all -o=json '[select(.kind == "Job") | select(.metadata.name | test("^opencode-research-state-")) | .spec.template]' \
      "$fixture/$application-$marker.yaml" > "$fixture/$application-$marker.json"
    jq -e 'length == 1' "$fixture/$application-$marker.json" >/dev/null
  done
  diff -u "$fixture/$application-a.json" "$fixture/$application-b.json"
done
printf '%s\n' 'Both temporary migration Job pod templates remain identical across real Kustomize image promotions.'

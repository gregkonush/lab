#!/usr/bin/env bash
# Run only after the reviewed migration revision has reached both applications.
set -euo pipefail
context=galactic-tailscale
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
evidence="${1:?Usage: migrate.sh <private-evidence-directory>}"
mkdir -p "$evidence"
chmod 700 "$evidence"
git -C "$root" diff --exit-code HEAD -- services/opencode/migrate_state.py services/opencode/migrate.sh >/dev/null
git -C "$root" rev-parse HEAD > "$evidence/migration-source-revision.txt"
sha256sum "$root/services/opencode/migrate_state.py" > "$evidence/migration-script.sha256"
migration_code="$(cat "$root/services/opencode/migrate_state.py")"
kubectl --context "$context" -n bayn get deployment bayn-opencode -o json > "$evidence/old-deployment.json"
jq -e '.spec.replicas == 0 and (.status.replicas // 0) == 0' "$evidence/old-deployment.json" >/dev/null
kubectl --context "$context" -n bayn get pods -l app.kubernetes.io/name=bayn-opencode -o json > "$evidence/old-pods.json"
jq -e '.items | length == 0' "$evidence/old-pods.json" >/dev/null
kubectl --context "$context" -n bayn get pvc bayn-opencode-state -o json > "$evidence/source-pvc.json"
expected_pvc_uid="$(kubectl --context "$context" -n bayn get job opencode-research-state-export -o json | jq -er '.metadata.annotations["migration.proompteng.ai/source-pvc-uid"]')"
jq -e --arg expected "$expected_pvc_uid" '.metadata.uid == $expected and .status.phase == "Bound"' "$evidence/source-pvc.json" >/dev/null
kubectl --context "$context" -n bayn get pods -o json > "$evidence/pvc-consumers.json"
jq -e '[.items[] | select(any(.spec.volumes[]?; .persistentVolumeClaim.claimName == "bayn-opencode-state")) | select(.metadata.labels["job-name"] != "opencode-research-state-export") | select(.status.phase != "Succeeded" and .status.phase != "Failed")] | length == 0' "$evidence/pvc-consumers.json" >/dev/null
source_pod="$(kubectl --context "$context" -n bayn get pods -l job-name=opencode-research-state-export -o json | jq -er '.items | if length == 1 then .[0].metadata.name else error("expected one source") end')"
target_pod="$(kubectl --context "$context" -n opencode get pods -l job-name=opencode-research-state-import -o json | jq -er '.items | if length == 1 then .[0].metadata.name else error("expected one target") end')"
kubectl --context "$context" -n bayn exec "$source_pod" -- python -c "$migration_code" verify /source > "$evidence/before.json"
manifest_sha256="$(python3 -c 'import hashlib,json,sys; state=json.load(open(sys.argv[1])); assert any(name.startswith("studies/") and name.endswith(".json") for name in state), "Missing retained study mappings"; assert any(name.startswith("attempts/") and name.endswith(".claim.json") for name in state), "Missing exclusive attempts"; print(hashlib.sha256(json.dumps(state,sort_keys=True).encode()).hexdigest())' "$evidence/before.json")"
# Save the complete archive before importing; never import a failed source stream.
kubectl --context "$context" -n bayn exec "$source_pod" -- python -c "$migration_code" export /source > "$evidence/state.tar"
sha256sum "$evidence/state.tar" > "$evidence/state.tar.sha256"
kubectl --context "$context" -n opencode exec -i "$target_pod" -- python -c "$migration_code" restore /data --manifest-sha256 "$manifest_sha256" < "$evidence/state.tar" > "$evidence/restored.json"
kubectl --context "$context" -n opencode rollout status deployment/opencode-research --timeout=120s
kubectl --context "$context" -n opencode exec deploy/opencode-research -c research -- python3 -c "$migration_code" verify /var/lib/bayn-opencode > "$evidence/after.json"
python3 - "$evidence" <<'PY'
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1])
before=json.loads((root/'before.json').read_text())
after=json.loads((root/'after.json').read_text())
restored=json.loads((root/'restored.json').read_text())
assert hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest()==restored['manifestSha256'], 'Restored manifest does not match the source'
claims={name:entry for name,entry in before.items() if name.startswith(('studies/','attempts/'))}
assert claims, 'Missing retained research evidence'
assert all(after.get(name)==entry for name,entry in claims.items()), 'Retained research claims changed after startup'
print('All restored bytes match the source; native startup retained every study mapping and exclusive attempt claim')
PY
kubectl --context "$context" -n opencode exec "$target_pod" -- touch /tmp/import-complete
kubectl --context "$context" -n bayn exec "$source_pod" -- touch /tmp/export-complete

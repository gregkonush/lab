#!/usr/bin/env bash
set -Eeuo pipefail

component_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source_root="$(cd -- "$component_dir/../../.." && pwd)"
readonly component_dir source_root
: "${OFZ_RECOVERY_TOOLS_IMAGE:?select the published Ofz image by digest}"
: "${OFZ_RECOVERY_SOURCE_SHA:?select the reviewed main commit}"
readonly OFZ_RECOVERY_DATA_ROOT=/var/lib/ofz-recovery
export OFZ_RECOVERY_DATA_ROOT

[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 && "$(id -u)" == 1000 ]] || {
  printf 'Run on the verified NUC as its existing UID 1000 operator\n' >&2; exit 1;
}
[[ "$OFZ_RECOVERY_TOOLS_IMAGE" =~ ^registry\.ide-newton\.ts\.net/lab/ofz@sha256:[0-9a-f]{64}$ && "$OFZ_RECOVERY_SOURCE_SHA" =~ ^[0-9a-f]{40}$ ]] || exit 2
[[ "$(cat "$source_root/.source-sha")" == "$OFZ_RECOVERY_SOURCE_SHA" ]] || {
  printf 'Reviewed source archive receipt required\n' >&2; exit 1;
}
for command in docker sudo tailscale jq flock python3; do command -v "$command" >/dev/null; done
[[ "$(tailscale status --json | jq -r .Self.DNSName)" == nuc.ide-newton.ts.net. ]] || exit 1

sudo install -d -m 0700 -o 1000 -g 1000 "$OFZ_RECOVERY_DATA_ROOT" "$OFZ_RECOVERY_DATA_ROOT/data" "$OFZ_RECOVERY_DATA_ROOT/secrets" "$OFZ_RECOVERY_DATA_ROOT/evidence"
exec 9>"$OFZ_RECOVERY_DATA_ROOT/deploy.lock"
flock --nonblock 9
if [[ -f "$OFZ_RECOVERY_DATA_ROOT/data/filer.sqlite3" && ! -f "$OFZ_RECOVERY_DATA_ROOT/secrets/manifest.json" ]]; then
  printf 'Restore the existing recovery credential manifest before deployment\n' >&2; exit 1;
fi
encryption_identity="$OFZ_RECOVERY_DATA_ROOT/evidence/encryption-key.sha256"
database_identity="$OFZ_RECOVERY_DATA_ROOT/evidence/database-writers.sha256"
if [[ -f "$encryption_identity" ]]; then
  [[ -f "$OFZ_RECOVERY_DATA_ROOT/secrets/sse_kek" && -f "$OFZ_RECOVERY_DATA_ROOT/secrets/sse_kek.sha256" ]] || {
    printf 'Restore the original recovery encryption key and fingerprint\n' >&2; exit 1;
  }
  cmp "$encryption_identity" "$OFZ_RECOVERY_DATA_ROOT/secrets/sse_kek.sha256"
fi
if [[ -f "$database_identity" ]]; then
  [[ -f "$OFZ_RECOVERY_DATA_ROOT/secrets/database-writers.json" && -f "$OFZ_RECOVERY_DATA_ROOT/secrets/database-writers.sha256" ]] || {
    printf 'Restore the original database backup credential manifest and fingerprint\n' >&2; exit 1;
  }
  cmp "$database_identity" "$OFZ_RECOVERY_DATA_ROOT/secrets/database-writers.sha256"
fi
docker pull "$OFZ_RECOVERY_TOOLS_IMAGE"
[[ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$OFZ_RECOVERY_TOOLS_IMAGE")" == "$OFZ_RECOVERY_SOURCE_SHA" ]] || {
  printf 'Tool image source revision does not match the reviewed source archive\n' >&2; exit 1;
}

initialize() {
  docker run --rm --network host --user 1000:1000 --read-only --cap-drop ALL \
    --security-opt no-new-privileges=true --memory 256m --pids-limit 64 \
    --env PYTHONDONTWRITEBYTECODE=1 --entrypoint /bin/python \
    --mount "type=bind,source=$source_root,target=/src,readonly" \
    --mount "type=bind,source=$OFZ_RECOVERY_DATA_ROOT/secrets,target=/run/ofz-secrets" \
    "$OFZ_RECOVERY_TOOLS_IMAGE" /src/devices/nuc/ofz-recovery/initialize.py "$1" /run/ofz-secrets
}
initialize prepare
python3 - "$OFZ_RECOVERY_DATA_ROOT/secrets/sse_kek.sha256" "$encryption_identity" \
  "$OFZ_RECOVERY_DATA_ROOT/secrets/database-writers.sha256" "$database_identity" <<'PY'
import os
import sys
import tempfile
from pathlib import Path
for source, target in zip(map(Path, sys.argv[1::2]), map(Path, sys.argv[2::2])):
    value = source.read_bytes()
    if target.exists():
        assert target.read_bytes() == value, "recovery credential identity changed"
    else:
        descriptor, temporary = tempfile.mkstemp(prefix=".identity-", dir=target.parent)
        try:
            with os.fdopen(descriptor, "wb") as out:
                out.write(value)
                out.flush()
                os.fsync(out.fileno())
            os.link(temporary, target)
        finally:
            os.unlink(temporary)
        descriptor = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
PY
docker compose -f "$component_dir/compose.yaml" config --quiet
docker compose -f "$component_dir/compose.yaml" pull archive
docker compose -f "$component_dir/compose.yaml" up --detach --force-recreate archive
deadline=$((SECONDS + 45))
until initialize configure; do
  (( SECONDS < deadline )) || exit 1
  sleep 1
done
container="$(docker compose -f "$component_dir/compose.yaml" ps --quiet archive)"
printf 'fs.configure -locationPrefix=/buckets/ -fsync -volumeGrowthCount=1 -apply\n' |
  docker exec --interactive "$container" /usr/bin/weed shell -master=127.0.0.1:9333 -filer=127.0.0.1:8888
printf 'fs.configure\n' |
  docker exec --interactive "$container" /usr/bin/weed shell -master=127.0.0.1:9333 -filer=127.0.0.1:8888 > "$OFZ_RECOVERY_DATA_ROOT/evidence/fsync.txt"
python3 - "$OFZ_RECOVERY_DATA_ROOT/evidence/fsync.txt" <<'PY'
import json
import sys
from pathlib import Path
text = Path(sys.argv[1]).read_text()
settings = json.JSONDecoder().raw_decode(text[text.index("{"):])[0]
assert any(row.get("locationPrefix") == "/buckets/" and row.get("fsync") is True for row in settings["locations"])
PY
initialize verify-local > "$OFZ_RECOVERY_DATA_ROOT/evidence/storage-verification.json"

before="$OFZ_RECOVERY_DATA_ROOT/evidence/serve-before.json"
after="$OFZ_RECOVERY_DATA_ROOT/evidence/serve-after.json"
sudo tailscale serve status --json | jq . > "$before"
jq --exit-status '(.TCP["9444"] == null or .TCP["9444"].HTTPS == true) and (.Web["nuc.ide-newton.ts.net:9444"] == null or .Web["nuc.ide-newton.ts.net:9444"] == {"Handlers":{"/":{"Proxy":"http://127.0.0.1:9445"}}}) and .AllowFunnel["nuc.ide-newton.ts.net:9444"] != true' "$before" >/dev/null
sudo tailscale serve --bg --https=9444 --yes http://127.0.0.1:9445 >/dev/null
sudo tailscale serve status --json | jq . > "$after"
normalize_other_services() {
  jq --sort-keys 'del(.TCP["9444"],.Web["nuc.ide-newton.ts.net:9444"],.AllowFunnel["nuc.ide-newton.ts.net:9444"]) | with_entries(select(.value != {} and .value != null))' "$1"
}
cmp <(normalize_other_services "$before") <(normalize_other_services "$after")
jq --exit-status '.TCP["9444"].HTTPS == true and .Web["nuc.ide-newton.ts.net:9444"] == {"Handlers":{"/":{"Proxy":"http://127.0.0.1:9445"}}} and .AllowFunnel["nuc.ide-newton.ts.net:9444"] != true' "$after" >/dev/null
printf '%s\n' "$OFZ_RECOVERY_SOURCE_SHA" > "$OFZ_RECOVERY_DATA_ROOT/evidence/source-sha"
printf 'NUC archive storage verified; verify the private TLS route from another peer before activation\n'

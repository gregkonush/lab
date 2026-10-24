#!/usr/bin/env bash
set -euo pipefail
kubectl --context galactic-tailscale -n opencode exec -i deployment/opencode -c opencode -- python3 - <<'PY'
import base64
import json
import os
from pathlib import Path
import urllib.request

password = Path(os.environ["HOME"], "server-password").read_text().strip()
authorization = base64.b64encode(f"opencode:{password}".encode()).decode()
request = urllib.request.Request(
    "http://127.0.0.1:4096/api/pair",
    method="POST",
    headers={"Authorization": f"Basic {authorization}"},
)
with urllib.request.urlopen(request, timeout=10) as response:
    pairing = json.load(response)
print("https://opencode.ide-newton.ts.net/auth/connect/" + pairing["code"])
PY

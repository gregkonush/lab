#!/usr/bin/env bash
set -euo pipefail
printf 'Paste the localhost ChatGPT callback URL (input is hidden): ' >&2
IFS= read -r -s callback_url
printf '\n' >&2
printf '%s\n' "$callback_url" | kubectl --context galactic-tailscale -n opencode exec -i deployment/opencode -c opencode -- python3 -c '
import base64
import http.client
import json
import os
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlsplit
import urllib.request

try:
    callback = urlsplit(sys.stdin.readline().strip())
    query = parse_qs(callback.query, keep_blank_values=True)
    valid = (callback.scheme == "http" and callback.hostname == "127.0.0.1"
             and callback.port is not None and callback.port > 1023 and callback.port != 4096
             and callback.path == "/auth/callback" and not callback.fragment
             and callback.username is None and callback.password is None
             and all(len(query.get(key, [])) == 1 and query[key][0] for key in ["code", "state"]))
except ValueError:
    valid = False
if not valid:
    raise SystemExit("Expected the original localhost /auth/callback URL with one code and state.")
password = Path(os.environ["HOME"], "server-password").read_text().strip()
authorization = base64.b64encode(f"opencode:{password}".encode()).decode()
request = urllib.request.Request("http://127.0.0.1:4096/api/info",
                                 headers={"Authorization": f"Basic {authorization}"})
with urllib.request.urlopen(request, timeout=10) as response:
    pid = json.load(response)["pid"]
inodes = set()
for descriptor in Path(f"/proc/{pid}/fd").iterdir():
    try:
        link = os.readlink(descriptor)
    except FileNotFoundError:
        continue
    if link.startswith("socket:["):
        inodes.add(link[8:-1])
listening = any(parts[1] == f"0100007F:{callback.port:04X}" and parts[3] == "0A"
                and parts[9] in inodes
                for parts in (line.split() for line in Path("/proc/net/tcp").read_text().splitlines()[1:]))
if not listening:
    raise SystemExit("No active callback on this port belongs to the deployed OpenCode server. Restart sign-in.")
connection = http.client.HTTPConnection("127.0.0.1", callback.port, timeout=30)
connection.request("GET", callback.path + "?" + callback.query)
response = connection.getresponse()
response.read(1048576)
connection.close()
if response.status != 200:
    raise SystemExit(f"Native OpenCode rejected the callback (HTTP {response.status}). Check its sign-in dialog.")
print("ChatGPT callback completed on the deployed OpenCode server.")
'
unset callback_url

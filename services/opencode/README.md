# OpenCode development server

The `opencode` Argo Application owns namespace `opencode`. Its native OpenCode
2.1.3 server runs at https://opencode.ide-newton.ts.net through a private Tailscale
Ingress. The image includes the same pinned `ciToolchain` as lab development,
plus a compiler, Rust/Clippy/Rustfmt, Ruff, Lua, Protobuf, SSH, SQLite, the CI-pinned
Promtool/Alloy validators and an init process. There is no Docker daemon
or Kubernetes service-account token in the development container. Docker/buildkit
clients need a separately authorized remote engine; installing clients grants no
cluster or registry authority.

The 50 GiB `opencode-development` PVC retains `/workspace` and the private home,
including sessions, provider authentication, caches and the server password.
The first boot clones the public lab repository. Later boots preserve the exact
checkout, branch and uncommitted work. Git push access requires an explicit user
login; the server does not inherit the operator's GitHub or Codex credentials.
The developer has an initialized single-user Nix store, so Nix commands can evaluate and
build without a root daemon. Project files, sessions and credentials persist on the PVC;
additional tools built into the container layer reset on rollout. The research container
keeps its read-only root filesystem.

Flamingo (`flamingo/qwen36-flamingo`) is the default. Native tools remain enabled.
The full native integration catalog remains available through Connect and Models.
Choose OpenAI > Sign in with ChatGPT to use a supported ChatGPT plan. Other
providers need their own credentials or credits; a catalog entry does not grant
access or make paid inference free. Provider credentials are stored only in the
personal home. No personal provider credentials are mounted into Bayn research.

The server creates a private 256-bit password once. Run `bash services/opencode/pair.sh`
from an administrator's checkout to create a one-time browser link. The helper
uses the deployed server's authenticated `/api/pair` endpoint. The password stays
inside the pod, and the printed link expires after five minutes. Paste the link
into the browser's **Connect to a server** screen. Keep both the password and
pairing links out of logs and commits. Unauthenticated requests to the
server API and pairing endpoint must fail. Tailnet membership and the scoped
Ingress NetworkPolicy provide a separate network boundary; Funnel is disabled.

## Connect ChatGPT from a remote browser

1. In **Settings > Providers**, connect **OpenAI > Sign in with ChatGPT** and
   complete the OpenAI account verification in your browser.
2. When OpenAI returns to a localhost callback page, copy its complete address.
   Run `bash services/opencode/complete-chatgpt-login.sh` from an administrator's
   checkout and paste it into the hidden prompt. Keep this URL out of chat,
   shell history and logs.
3. Return to OpenCode and confirm **ChatGPT connected** before selecting a model.

The [pinned upstream provider](https://github.com/anomalyco/opencode/blob/v2.1.3/packages/core/src/plugin/provider/chatgpt.ts)
binds a random loopback callback inside the pod. The helper verifies that the port
belongs to the deployed OpenCode process, then delivers the callback to it.
Native OpenCode retains state, PKCE, client identity and ID-token verification.
Credentials remain in the personal PVC. **Codex device code (legacy)** is also
available when you prefer a sign-in without a loopback browser callback.

## Retained research state

Bayn's bounded research gateway moves to `opencode-research` within this
application. It retains its pinned CLI, read-only agent, one-call relay,
free-only model, frozen configuration hash, exclusive attempts and study mapping.
It has a separate protected PVC and no personal development credentials; its agent cannot use development tools.
Server and Bayn worker images release independently: receipts retain both actual
source revisions. The HTTP source attestation must match the response's server
revision, while model/configuration/request/stream/cost/timing evidence still
passes the existing verifier. A server revision cannot be relabeled as the worker.

The protected `bayn/bayn-opencode-state` PVC retains the original volume as
recovery evidence. No active workload mounts it. The temporary migration Jobs and
old gateway Deployment, Service and NetworkPolicy are retired after the verified
transfer. The gateway continues to use `/var/lib/bayn-opencode` within its separate
`opencode-research-state` PVC so native paths and the frozen configuration stay valid.

The one-time migration implementation is retained in [PR #15336](https://github.com/proompteng/lab/pull/15336).
It stops the original writer before export, verifies the source PVC identity,
binds the archive to a frozen inventory hash and checks every restored byte and
SQLite database before activation. `migrate_state.py` retains the offline archive
verification and restore functions. Restore refuses an existing destination and
rejects escaping paths and unsafe links. The target waits for the atomic
`.migration-complete.json` marker before starting.

[Migration proof](migration-proof.json) records the archive and frozen inventory
hashes, source and target PVC identities, and the retained session and claim counts.
The private archive contains the source bytes and remains outside the repository.

Keep the private migration archive and pre/post native session and claim identities
with the delivery evidence. Before recovery, stop the active writer. After any new
requests, migrate the latest state with the same checks before changing writers.
Never activate two writers for one study or retry an already claimed financial attempt.

Image delivery is reviewed main -> immutable `lab/opencode` publication ->
Warehouse/Stage `opencode` in `lab-delivery` -> `kargo/opencode` -> Argo. The Stage
updates the Kustomize input by digest. `bayn` keeps its trading runtime, Jev
credentials, risk checks and capital authority. This deployment does not qualify
Bayn's trading performance or complete prior failed financial experiments.

Validation: `python3 -m unittest discover -s services/opencode`, research receipt
and native gateway tests, rendered manifests and the image's offline server/tool
verification. Live acceptance additionally requires authenticated Tailscale use,
Flamingo tool execution, ChatGPT login and inference, a real repository edit/test,
restart persistence and the retained research migration proof.

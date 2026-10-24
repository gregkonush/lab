# OpenCode development server

The `opencode` Argo Application owns namespace `opencode`. Its native OpenCode
2.1.3 server runs at https://opencode.ide-newton.ts.net through a private Tailscale
Ingress. The image includes the same pinned `ciToolchain` as lab development,
plus a compiler, Rust, SSH, SQLite and an init process. There is no Docker daemon
or Kubernetes service-account token in the development container. Docker/buildkit
clients need a separately authorized remote engine; installing clients grants no
cluster or registry authority.

The 50 GiB `opencode-development` PVC retains `/workspace` and the private home,
including sessions, provider authentication, caches and the server password.
The first boot clones the public lab repository. Later boots preserve the exact
checkout, branch and uncommitted work. Git push access requires an explicit user
login; the server does not inherit the operator's GitHub or Codex credentials.
The root filesystem is read only; workspace, home and temporary files are writable.

Flamingo (`flamingo/qwen36-flamingo`) is the default. Native tools remain enabled.
The full native integration catalog remains available through Connect and Models.
Choose OpenAI > Sign in with ChatGPT to use a supported ChatGPT plan. Other
providers need their own credentials or credits; a catalog entry does not grant
access or make paid inference free. Provider credentials are stored only in the
personal home. No personal provider credentials are mounted into Bayn research.

The server creates a private 256-bit password once. Use native pairing from an
administrator-controlled pod session to connect the browser; do not print the
password in logs, commit it or place it in a URL. Unauthenticated requests to the
server API and pairing endpoint must fail. Tailnet membership and the scoped
Ingress NetworkPolicy provide a separate network boundary; Funnel is disabled.

## Research state migration

Bayn's bounded research gateway moves to `opencode-research` within this
application. It retains its pinned CLI, read-only agent, one-call relay,
free-only model, frozen configuration hash, exclusive attempts and study mapping.
It has a separate protected PVC and no personal development credentials; its agent cannot use development tools.
Server and Bayn worker images release independently: receipts retain both actual
source revisions. The HTTP source attestation must match the response's server
revision, while model/configuration/request/stream/cost/timing evidence still
passes the existing verifier. A server revision cannot be relabeled as the worker.

The migration must run after GitOps scales the old writer to zero **and no old
pod remains, including terminating pods**. Retain the original protected PVC.
Reviewed source/restore Jobs mount only the old/new research PVCs, with no tokens
or external network access. Stream `migrate_state.py export` from the read-only
source Job through authenticated `kubectl exec` to `migrate_state.py restore` in
the destination Job, using shell `pipefail`. The source and destination manifests
must match, SQLite quick checks must pass, and source files must be unchanged.
Restore binds the source inventory hash before activation, refuses an existing destination
and rejects escaping archive entries. Use `bash services/opencode/migrate.sh <private-evidence-directory>`
from the reviewed checkout after both migration Jobs are ready.
The target gateway waits for the atomic `.migration-complete.json` marker before
starting; failed or interrupted imports cannot silently create fresh sessions.
Keep both archives and exact pre/post claim/session identities as delivery evidence.
Remove temporary Jobs only after proof. Roll back before new requests by restoring
the old committed configuration and its untouched PVC. After new requests, stop
both writers and migrate the latest state back with the same checks first; never
activate two writers for one study or retry an already claimed financial attempt.

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

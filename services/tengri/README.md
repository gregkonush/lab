# Tengri control plane

The signed guest request protocol is implemented by the Rust `guest_authorization` library and Nanoagent's
`internal/guestauth` package. Protocol 4 binds the actor, Ofz audit receipt and recovery generation, full runtime claim,
controller fence, action, content target, request hash, five-second admission deadline and nonce. Its Ed25519
signing key belongs only in the controller; supervisors and guests receive the public key. Shared deterministic vectors
cover both languages and all 19 RPC classifications against the Ofz operation catalog. Regenerate them with
`node services/tengri/fixtures/generate-ofz-guest-request-v4.mjs` from the repository root.

Ofz checks the complete observation policy before the controller signs the exact request. Scoped proofs carry only
the per-request byte/item budget, with no reusable root or ID lists. The decoded proof remains bounded at 16 KiB,
including JSON escaping of a maximum 4096-byte target. Protocol 3, its full-policy scope and its signing domain are
rejected; all three consumers migrate in the same paired release.

Every controller guest call requires a fresh Ofz decision and the current shared SQL leader fence. The proof expires
at the earlier of the Ofz decision deadline and five seconds; signing does not restart the authorization lifetime.
Controller ownership uses a 60-second SQL and Kubernetes lease, renewed every five seconds. Acquisition and renewal
measure their local deadline from the start of the attempt, so a delayed commit never grants an extra lease window.
Acquisition waits within that window for the durable result; an unconfirmed acquisition grants no authority. Renewal
keeps its in-flight commit until the previously confirmed deadline, then fences all controller work. This covers the
observed 20.9-second commit tail without changing request lifetimes or synchronous database durability. After a crash,
ownership expires after 60 seconds; election polling and durable acquisition can add failover time. A known ownership
loss still stops the controller immediately.
Schema/readiness checks and leadership reads, acquisition, renewal and release use a separate two-connection SQL pool.
Ticket writes retain their existing request pools: twelve connections per controller and two per supervisor.
Blocked request writes cannot exhaust the connections used to confirm runtime authority. Both pools use the same
verified database TLS configuration, SQL identity and query limits; every fence check still reads current SQL authority.
Two controller replicas and one rolling-update surge need at most 42 connections. Six supervisors need 24 connections
in total. Promote the Ofz managed-role limits and 220-connection server budget before rolling out the separated pools;
reducing them while these pools are active can reject connections. No runtime schema migration or credential rotation is required.
Readiness probes and terminal cleanup use separately audited, narrowly typed workload decisions. The supervisor
verifies the actual canonical opening protobuf, runtime claim, Pod UID, leader fence and installed recovery generation,
then consumes the nonce in a bounded process-wide replay guard before opening vsock. Each proof names one Pod UID,
and Kubernetes runs one supervisor container/listener for that Pod. Before listening after process start, the supervisor
waits eight seconds on a monotonic clock: the maximum five-second signed admission lifetime, the existing one-second
clock-lead bound and two seconds of restart margin.
The health listener remains live during this wait; readiness returns 503 until the fence clears.
Every proof that could have executed before a crash therefore expires before the replacement can admit requests.
The guard is shared across admission instances and allows one consumer per nonce, with 64 buckets of at most 128
unexpired entries. A read-only SQL deadline check preserves the database clock and future bound without a WAL commit.
Signature, body, runtime, recovery generation and current SQL leadership checks still precede effects.
The BFF obtains a random process audience through `GetRequestAudience` over the pinned SPIFFE mTLS channel before
signing each controller request. Signing domain `tengri.ofz.v2` binds that audience as well as the method, body, nonce,
context and recovery generation. Each controller consumes nonces in one shared process window with 64 buckets of
128 live entries, expiring at the signed five-second deadline. A restart chooses a different audience; requests
captured for the previous process or another replica fail before effects, even when their signatures are otherwise
valid. Replacing only the audience invalidates the HMAC. Live entries are never evicted to admit more work, and no
expired assertion can become valid again after a backwards clock correction: the replay window keeps a nondecreasing
clock floor for its process audience. No
request is automatically replayed if its receiver changes between audience lookup and submission. There is no v1
signature path. Regenerate the independent Rust/TypeScript vector with
`node services/tengri/fixtures/generate-ofz-request-v2.mjs`.
The SQL replay schema remains required for the BFF's shared OAuth and one-use capability state. Controller request
authentication no longer adds a WAL commit before Ofz can evaluate the request.
Repeated metadata and observation requests reuse an already committed Ofz audit receipt for the exact actor,
session, grant, origin, workspace/runtime, action, resource, target and recovery generation. Every request still calls
Ofz for a fresh fully consistent policy decision and checks the receipt binding. The bounded 4096-entry process
cache holds receipt IDs, never authorization decisions, and expires them before Ofz's eight-hour receipt limit.
Control submissions retain their separate durable audits and session activity updates.
Initial audit admission has a thirty-second processing budget, matching Ofz's existing request-context bound.
The BFF assertion is still admitted within five seconds; after verifying it, the controller requests a fresh Ofz
decision with that separate audit budget. Ofz rechecks the current session, policy and runtime after the durable
commit and returns a decision valid for at most two seconds. Receipt revalidation retains its two-second timeout.
A slow commit therefore does not automatically trigger a new admission every five seconds, and waiting for an audit
does not lengthen a signed assertion or authorize access from a stale policy decision. BFF unary operations allow
thirty-five seconds for audit admission and the subsequent guest call; streaming operations retain their cancellation.
Workspace creation allows 125 seconds for its thirty-second enrollment polling window and three sequential thirty-second
admissions: reservation validation, the last in-flight runtime-state admission and final workspace metadata authorization.
Its reservation ID still recovers an uncertain outcome.
Conversation history, Codex events and file streams share their workspace admission with the guest connection, so one
stream submission does not create a second parent audit. Guest sub-operations retain their separate control audits;
stream disclosure and revocation still check current Ofz policy using the original admission's receipt.
Controller runtime-state reads and guest health probes use the same bounded receipt cache. Its binding includes the
current recovery generation, read from Ofz before each lookup. Ofz still checks workload policy and current runtime
state before and after validating the durable receipt; changing the owner, epoch, membership, archive health or fence
cannot reuse a previous decision. Terminal cleanup remains a separately audited control submission.
Transport failures during reconciliation mark readiness `Unknown` and retain the last observed guest phase. The BFF
reports that uncertainty as unavailable, preserving the existing desktop until a new observation succeeds. A transport
timeout does not establish that the VM failed; actual lifecycle and invariant failures retain their failure handling.
Ofz policy checks and durable audit receipts still precede every guest operation. Supervisor request admission no longer adds a
PostgreSQL commit inside the short-lived Ofz decision window. The supervisor replay guard changes no signed fields;
rolling a supervisor adds an eight-second startup fence and retains the runner, guest and home. Buffered admission
capacity follows the opening message's storage, with a 64 MiB total byte budget. RPCs reserve their declared opening size after reading the frame
header; previews reserve their bounded body size. Capacity checks never queue large reservations ahead of smaller
requests. A separate limit of 32 requests bounds work through response headers, without charging ongoing streams.
Exhausted capacity returns 503 promptly. Capacity checks and body reads have separate trace spans. Per-message size,
signed deadlines, replay and runtime fencing checks remain enforced.

Nanoagent verifies the proof again against its root-owned runtime claim and recovery generation and consumes a local
nonce before handler effects. Runtime changes fence unary responses and stream output. HTTP and WebSocket preview
openings bind the actual verb, escaped path/query and body; preview proof and claim headers are removed before reaching
the application. Scoped content remains denied until bounded observer handlers exist.
Preview WebSockets send protocol keepalives on both proxy hops every twenty seconds so idle connections remain open.
Control frames do not record user activity or postpone automatic sleep; runtime and policy revocation still close the stream.
Desktop previews renew their 30-minute SQL lease and HttpOnly cookie through fresh authenticated tickets on the same
window origin. Token rotation rejects new handshakes using the old credential. Established sockets retain their
actor/session/grant, workspace/runtime, permission, origin, recovery generation and port binding. They check the
current unexpired lease and fresh Ofz policy every second, with the existing two-second deadline. Renewal preserves
both application documents and sockets; deletion, expiry or policy denial still closes them within three seconds.

The controller requires `TENGRI_GUEST_SIGNING_KEY_FILE` and `TENGRI_GUEST_RECOVERY_GENERATION_FILE`. The runner and
supervisor require `TENGRI_GUEST_VERIFICATION_KEY_FILE` and `TENGRI_GUEST_RECOVERY_GENERATION_FILE`; their projected
bundle contains only the public key and generation. Guest init stages both, clears the old claim before freeze/resume,
and atomically publishes the resumed claim. A restored authority requires key rotation and trusted slot preparation
under the new recovery generation before admission resumes. The migration gate remains closed until native KVM,
independent execution fencing, observers, recovery and the remaining plan gates pass.

Tengri owns `runtime.proompteng.ai/v1alpha1 MicroVM` resources and six prepared Firecracker slots. Every guest has
4 vCPU, 8 GiB RAM, a private 1.5 GiB root disk, and a retained 32 GiB Ceph home. Creation restores a prepared snapshot;
resume restores that owner's latest committed snapshot. Neither request schedules a Pod, attaches storage, boots a
kernel, or installs tools. Empty or preparing capacity returns an explicit error.

The host runner reserves 9 GiB, including 1 GiB beyond guest RAM for preparation and VMM overhead, matching the native
acceptance fixture. Artifact staging has a separate 3 GiB limit so copying the boot disk does not exhaust a 128 MiB
container through charged file pages. The namespace quota covers all six runners, supervisors, and the controller.

Sleep freezes and snapshots the guest, flushes its disks, stops and reaps the VMM, and evicts the snapshot's file pages
before acknowledging completion. The stable slot Pod, home PVC, TAP, and small host supervisor remain. Kubernetes
resource requests still reserve resume capacity even while resident guest RAM is released.

This source uses one runtime. The previous Kata Pod lifecycle and guest SPIRE/token-refresh implementation are
removed. The authorized hard cutover deleted the old workspaces and homes. Retire the old unclaimed prepared pool
before activating the new contract; fresh workspaces receive new homes and grants. Source and local tests do not
establish a deployed migration or the authenticated p95 latency target.

## Slot ownership and failure handling

Each slot has a Kubernetes Lease and one private Pod. `MicroVM.spec.slot` records the slot, Pod UID, home name/UID,
and epoch. The controller binds the MicroVM with resourceVersion compare-and-swap before claiming the Lease. Concurrent
claims cannot assign two slots to one MicroVM UID or start two owners in one slot. Deletion before a Lease claim
consumes the candidate epoch with the same Lease CAS, preventing a late claim while retaining the unused prepared slot.

The Lease allocation identifies retained storage custody by MicroVM name, UID and slot epoch. An executing runtime
claim additionally requires the canonical Ofz runtime epoch. Guest RPC, preview HTTP and WebSocket admission require
one exact UID, slot-epoch and runtime-epoch header each. Existing connections close when that full claim changes.
A newer runtime cannot reuse an earlier awake claim: reconciliation first saves the old runtime, then checks fresh
Ofz authority before restoring the new epoch from the same allocation's committed snapshot. Guest init accepts a
changed runtime only while frozen for that exact allocation. A never-started workspace retains its prepared home
without creating a runtime claim. Termination observes the current claim under the installed leader fence; an unused
slot receives a deterministic retirement identity solely for stop acknowledgement.

Runtime epochs are mandatory in private lifecycle claims and owned journals. Paired controller/guest artifacts and
new root disks are required at the coordinated hard cutover. No old home or journal is imported. Scoped observers and
the independent host execution deadline remain separate authorization work.

The runner's durable journal binds the Pod and home UID, guest image, kernel digest, Firecracker revision, CPU identity,
snapshot generation, and owner/epoch. The packaged Firecracker is built from the checksum-pinned 1.16.1 source with its
upstream Rust 1.95.0 toolchain and release musl seccomp policy. Its memory snapshot file uses direct I/O, avoiding a second
buffered copy of guest RAM that can exhaust the runner's memory limit during sleep. The journal records this patch as
`1.16.1+tengri-async-io.6`; journals from another VMM revision require fenced recovery. Disk writes start on the
bounded io_uring workers, so buffered writes cannot run inline on the VMM thread that also handles terminal vsock traffic.
The ring requires pre-registered files and permits only read, write, and flush operations.
New full memory snapshots retain zero pages as file holes, with the same logical length and byte contents. Existing
nonempty snapshot files still overwrite zero pages, including a snapshot backing the current guest mapping; diff
snapshots keep their existing dirty-page writes. This reduces disk writes and cold reads without retaining resident
snapshot pages during sleep. Snapshot restore uses upstream demand paging and normal read-ahead. Snapshot restore consumes the
generation before vCPUs run, then synchronizes the guest clock before thawing root/home,
binds the owner, and checks files, a round trip on the guest's prepared readiness PTY, and initialized Codex. The host samples the clock after the vsock handshake so connection and thaw time cannot leave fresh authorization proofs ahead of the guest clock. The readiness shell survives in the snapshot rather than being forked again during restore. A failed save may resume
only the still-live guest. Older memory is never restored against disks that may have advanced.

If the final sleep journal write fails after a completed save, the runner retains that snapshot's pending commit.
Snapshot page eviction and obsolete-generation cleanup run after retaining the completed snapshot, so either failure can
retry that same commit without saving again. A failed save that resumes the live guest also retains its pending `Awake` commit until durable;
a retry publishes that recovered state and reports the failed sleep without claiming RAM release.
Only the same owner and epoch can retry either outcome. A runner restart still requires explicit fenced recovery for an interrupted save.

Initial root staging runs after the preparation journal and control socket exist. Token or `debugfs` failures become
visible unclaimed failures that the pool can retire; a restart keeps that failure instead of poisoning the slot before its journal exists.

Loss of an active runner, Pod, or node retains the owner and home for explicit fenced recovery. Lease age, missing
Pods, and controller disconnection never authorize a replacement writer. Sleeping journals can reopen only with
unchanged runtime and disk identities. An exited VMM fences traffic and reports failure.

Lifecycle commands monitor database leadership throughout execution. Withdrawn authority closes the private command's
write side; the runner cancels that operation, terminates and reaps its VMM, and durably retains a failed claim before
acknowledging. A separate fencing command covers a completion racing with authority loss. Replacement leadership waits
for that fencing proof under the admission gate. If proof is unavailable, the supervisor quarantines admission instead
of installing another leader. Cancellation retains an in-progress journal writer until it completes, so a detached
fsync cannot overwrite the fencing record. This does not provide the independent host execution deadline required for
the authorization cutover.

Guest openings share the lifecycle barrier so independent admissions can proceed concurrently. Sleep, stop, status
publication and leader-fence installation take it exclusively. The existing opening byte limits and two-buffer
admission capacity remain in force.

Deletion of a claimed slot persists proof of VMM termination before deleting the slot Pod, then removes only matching assets with UID
and resourceVersion preconditions. A retry after Pod deletion uses the durable receipt. No stop proof means no disk
or finalizer removal for an owned slot. A replacement slot always gets a fresh Pod, home, token, and snapshot. Image updates recycle
only unused slots; claimed guests retain their runtime through ordinary sleep/resume.

## Host and guest boundaries

The slot runs under the normal OCI runtime with separate container PID namespaces, no host networking/mounts,
and no Kubernetes API token. The supervisor mounts the SPIFFE CSI socket, private control sockets and its restricted database credential. The runner
mounts only its boot artifacts, disks, token, and sockets.

The short-lived TAP init container receives NET_ADMIN inside the Pod network namespace. It creates `tengri0`, private
10.250.0.0/30 addressing, NAT, and protected-destination filtering. It asserts CNI forwarding is already enabled and
never changes node sysctls, routes, bridges, scheduling, or machine configuration.
The TAP uses the smaller of the Pod interface MTU and 1500 bytes. TCP SYN and SYN-ACK packets cap their advertised
segment size in both directions without raising an existing smaller value. The isolated KVM fixture also inherits
its execution network MTU inside its private Docker interface, so a 1400-byte CNI path is exercised correctly.
The Linux browser acceptance fixture also uses an ephemeral Docker bridge with that MTU and removes it after the test.

The runner briefly starts as root with MKNOD/SETUID/SETGID. It creates a private device inode in its container's `/dev`
for the allocated raw home device, then drops to UID/GID 65532 with no effective, permitted, inheritable, or ambient
capabilities. It never chmods a node device. Firecracker inherits that unprivileged identity, no environment secrets,
no capabilities, NoNewPrivs, and its default seccomp filter.

The separately reviewed [device allocation](../../argocd/applications/tengri-devices/) installs slot admission before
advertising devices and delegates only KVM and TUN
through the official generic device plugin. The platform ApplicationSet enrolls it in `kube-system` at wave 1, before
the controller's wave 2. Verify actual device allocations before an authorized cutover. The existing namespace admission
already permits this narrowly constrained profile; no namespace policy change is required. The final cutover retires
legacy guest SPIRE attestation, the `nanoagent` ServiceAccount, token/registration RBAC, static-entry admission, bundle
publication, and the old guest network path after the final old guest and its storage writer are fenced. Slots use only
the host supervisor registration and private vsock credential.

The image workflows withhold the Tengri, Nanoagent, and Proompteng Kargo aliases until the repository variable `TENGRI_PREPARED_SLOT_CUTOVER_READY`
is exactly `true`. Keep it false until the authorized cutover has removed the old workspaces and homes and the new
authority dependencies are ready for the immutable image pair. The owner chose fresh workspaces for this cutover;
no retained-data import or migration rehearsal is required. Kargo's existing automatic promotion policy remains in place.
Proompteng's resume API uses the streaming controller contract, so its BFF must join the same approved maintenance
cutover. Restore lifecycle traffic only after both applications run the reviewed source and conversation recovery passes.

Nanoagent runs as UID 1000 in the guest, with passwordless sudo inside that guest. Guest root edits and processes
survive snapshot sleep. Root and memory are local to the slot Pod and reset after an explicitly fenced cold replacement;
the home PVC remains the durable boundary. No guest process receives the host Workload API socket or host identity.

## Transport and workload identity

Controller renewal keeps one in-flight attempt after its two-second warning threshold. Authority still ends at the
last confirmed lease deadline while that attempt finishes. A successful reply extends authority from the attempt's
start, so a slow response cannot overstate the database lease. Ownership loss or a returned error closes authority
immediately; late renewal replies cannot revive expired authority.

Browser requests enter the authenticated BFF. The BFF signs owner-scoped gRPC requests to Tengri with replay protection.
SPIRE mTLS authenticates both host hops. Signed BFF requests keep their five-second deadline. The independent
replay database permits at most one second of clock lead in its future bound and retains the exact signed expiry;
expired requests and used nonces remain rejected. Tengri's identity is `spiffe://proompteng.ai/ns/tengri/sa/tengri`; its port 50051
accepts only `spiffe://proompteng.ai/ns/proompteng/sa/proompteng`. Every slot supervisor has
`spiffe://proompteng.ai/ns/tengri/slot/pod/<Pod UID>` and accepts only Tengri. Certificates rotate outside guest memory.

The supervisor serves mTLS port 8443 and requires the exact MicroVM UID/epoch before forwarding files, terminals,
Codex, previews, or editor content over vsock port 1024. Nanoagent additionally validates the unique slot credential.
Lifecycle commands use a private host Unix socket; guest freeze/resume uses separate vsock port 1025. Guest health
binds only loopback port 8080. Supervisor health on host port 8080 never dispatches guest RPCs.

The [NanoagentService contract](proto/proompteng/runtime/guest/v1/nanoagent.proto) carries unary operations, server
streams, and the bidirectional terminal stream. Tengri translates terminal frames into browser WebSockets; application
and editor previews retain HTTP/WebSocket proxying. Rust bindings are generated by build.rs. Regenerate committed Go
bindings with `bash services/nanoagent/generate-proto.sh`. `bash services/tengri/test-rpc-interop.sh` exercises the real
Rust/Go wire protocol, exact peer rejection, and SVID renewal.

Terminal creation has one protocol: every client supplies a stable 16-to-128-character `creation_id`, and Nanoagent
returns that exact identity with the session. Retries reuse the same identity and are idempotent. Tengri rejects
id-less requests instead of generating a compatibility identity or negotiating with an older guest.

Pending Codex device logins are guest-owned. A reconnecting desktop reads the active attempt from Nanoagent and keeps
the same verification code and original expiry instead of silently starting and invalidating another attempt.

Workspace file reads return bounded protobuf bytes and a required strong SHA-256 revision. Tengri verifies that the
revision matches the content and rejects missing, malformed, or mismatched revisions. Writes require a lowercase
64-character SHA-256 `expected_revision` or `missing` for create-only writes; malformed preconditions fail before
contacting the guest. Nanoagent reports stale writes as `ABORTED` with the current revision. Successful writes return
the new path, size, and revision.

Paginated Codex conversations resume with `excludeTurns: true`, then load `thread/items/list` and metadata-only
`thread/turns/list` in ascending pages. Each item carries the event cursor captured with its page; the desktop uses
that cursor to discard covered replay while retaining updates that arrive after an earlier page. The initial resume
cursor remains the baseline for new items. The controller streams metadata, item pages, and turn pages through `ResumeCodexThread`; the BFF forwards bounded
NDJSON records and the desktop assembles the complete snapshot. Retrieval is bounded to 90 seconds, 256 pages,
10 MiB per native page, and 64 MiB of total native JSON. The desktop enforces the same aggregate byte budget before
parsing each page. An explicit completion record is required, and any
failed or interrupted page fails the restore instead of displaying incomplete history. Threads explicitly marked `legacy` retain the
single full-history snapshot and cursor contract required by their reconstructed item identities.

The guest pins Codex 0.159.2 in `services/nanoagent/bootstrap-codex.sh` so ChatGPT-backed guests can use
`gpt-6.1-sol`. Its generated item-page schema returns `{ turnId, item }` entries, not bare items. The independently generated `packages/codex` SDK is not the guest
protocol authority. Verify changes against the pinned binary with
`codex app-server generate-json-schema --experimental --out <temporary-directory>`.

Every supported guest exposes `model/list`. Catalog failures remain ordinary request failures; the desktop requires
a valid model and reasoning selection before starting a turn and offers a catalog retry. There is no older-guest mode
that silently drops selected settings. Existing history and active turns can still be recovered during a catalog outage.

Each Chrome preview load exchanges its one-use ticket for a bounded, owner-scoped session whose ID is allocated before
the browser receives the ticket. The desktop revokes both unused tickets and active sessions when a preview is
superseded or closed, so reload and history use cannot exhaust the per-agent session limit. The gateway injects a
nonce-authorized navigation bridge into uncompressed HTML responses; the desktop accepts navigation and shortcut
events only from the exact issued preview origin and iframe. This keeps the virtual address bar, history, reload, and
Chrome shortcuts synchronized without exposing the session token to guest applications.

Public HTTP traffic is split across two listeners with separate routers and Kubernetes Services. Port `8080` exposes
only Tengri-owned control routes such as terminal WebSockets, preview-session opening, probes, and metrics. Port `8081`
exposes only session-host bootstrap assets and the authenticated guest preview proxy. Traefik routes
`tengri.proompteng.ai` control paths to `tengri-gateway:8080` and session hosts to `tengri-preview:8081`; observability
can reach only the control listener. A guest application may therefore own paths such as `/metrics` or `/healthz`
without those requests reaching Tengri's own handlers.

`/livez` reports process liveness. `/readyz` and the compatibility `/healthz` alias report success only while the
Kubernetes control path, Ofz authority, and shared SQL state are usable; deployment probes do not advertise an isolated process
as ready to accept agent operations.

## Workspace authorization

Ofz owns authorization for the controller and BFF. Tengri calls the canonical
[AuthorizationService](../../proto/proompteng/authz/v1/authz.proto) over exact-peer SPIFFE mutual TLS; it never
receives a SpiceDB administrative key, installs schema, or creates owner tuples directly. The canonical
[operation catalog](../ofz/operations.json) maps each runtime RPC to an explicit action. Local Kubernetes labels,
names and owner fields locate resources; Ofz checks the actual MicroVM UID and current runtime epoch.

The BFF carries the human ID, opaque session ID, trace ID, workspace UID, runtime epoch, origin, contract version and
recovery generation. One mounted 32-byte key encoded as lowercase hexadecimal signs the canonical protobuf body,
RPC path, full context and fresh nonce. Tengri reads `TENGRI_INTERNAL_HMAC_KEY_FILE` for each request. There is no
old owner-header or multi-key protocol. Cutover rotates both peers together while traffic is fenced.
`OFZ_GRPC_ENDPOINT` is a fixed DNS authority and must present `spiffe://proompteng.ai/ns/ofz/sa/ofz-api`.
The active controller and BFF manifests both select the namespace-local `tengri-internal-request-key` Secret,
whose `TENGRI_INTERNAL_HMAC_SECRET` entry must contain the same rotated key. The controller additionally mounts
`tengri-controller-db` and `ofz-database-ca`. Provision these before promotion; missing credentials fail startup.

`TENGRI_DATABASE_DSN`, `TENGRI_DATABASE_PASSWORD_FILE` and `TENGRI_DATABASE_CA_FILE` select the TLS-only
`tengri_control` database. Controller and supervisor use separate `tengri_controller` and `tengri_supervisor` roles.
Only Ofz's `migrate-runtime` command runs the checksum-bound schema migration as `tengri_migrator`. Applications
verify that schema before serving. SQL stores hashed replay receipts, hashed one-use tickets and preview sessions;
plaintext credentials are returned only to their caller. Limits and atomic redemption apply across replicas.
Replay admission hashes each nonce into one of 64 buckets with 128 fixed slots. An expired slot is claimed with
`FOR UPDATE SKIP LOCKED`; unrelated nonces can proceed even in the same bucket. Duplicate rejection remains atomic
across replicas, the table remains bounded at 8,192 entries, and the signed expiry has no grace period.
Migration `0003_replay_slots.sql` preserves accepted nonces while replacing the earlier bucket locks. Migration
`0004_leadership_window.sql` installs the 60-second ownership window. Migration `0005_capability_slots.sql` preserves
existing capabilities and assigns unique capacity slots. Ticket and preview writers skip slots reserved by in-flight
transactions and skip locked expired rows instead of taking one global lock through commit. Database constraints
retain the limits of 128 tickets, 96 previews, and 16 of each per workspace. Reissuing an existing preview retains
its slots and replaces its token atomically. Ofz must apply all five checksum-bound migrations
before the new BFF, controller and supervisor start; no older schema is accepted.
For claimed slots, the elected controller reconciles the supervisor container's image in place using the Pod UID,
resource version and current MicroVM ownership. Kubernetes restarts that proxy while retaining the same runner,
Firecracker guest, home, slot claim and Pod identity. Active streams reconnect to their existing guest sessions.
Unused slots continue through the normal retirement and preparation path for the promoted controller/guest pair.

Generated slot Pods mount the `tengri-supervisor-db` Secret's `password` and the `ofz-database-ca` Secret's `ca.crt`
only into the supervisor. Its fixed database authority is `ofz-db-rw.ofz.svc.cluster.local`, database `tengri_control`,
role `tengri_supervisor`. The runner and guest receive neither credential. Provision both reviewed Secrets before
enabling slot creation during cutover.
Supervisor readiness checks the shared database schema and runner state together under a two-second deadline.
A vacant, awake or sleeping runner cannot advertise a usable slot while its supervisor's database connection is
unavailable. Process liveness remains independent of that dependency.

The namespace reserves seven Leases for six slots and the controller election. Its twelve-Secret quota covers
six slot bootstraps, four Ofz credentials and the two old keys retained until the fenced cutover. NetworkPolicy
permits the controller to call Ofz on 9443 and both controller and supervisors to reach only Ofz PostgreSQL on 5432.

The controller combines the Kubernetes leader Lease with a database generation and lease deadline. Its work futures
are cancelled before releasing leadership, every mutation checks the current local guard, and each supervisor checks
the installed database fence before and after lifecycle or guest forwarding. SQL failure or expired leadership rejects
protected requests. Leadership alone is not proof of a guest execution permit; the complete execution fencing and
revocation qualification remains part of the [migration plan](../../docs/tengri/ofz-enterprise-authorization-plan.md).
Before restoring a guest, the client installs the current controller fence and then reads fresh Ofz runtime authority.
It checks the exact workspace, owner, runtime epoch, policy version, retained home and reservation, and rejects an
expired or denied decision immediately before sending restore. Sleep and stop remain separate fenced operations.

Ofz reserves 32 GiB before creation. Before claiming a slot, the controller binds the reservation to the exact MicroVM
UID with `BeginWorkspaceEnrollment`. An unbound reservation expires after five minutes; an accepted enrollment remains
quota-counted while its slot is being claimed, and creation retries recover that accepted binding. If the owner is
offboarded before enrollment finishes, the controller records the exact home as quarantined with no runtime authority.
The controller enrolls the exact retained home, reservation and UID once;
later reconciliation reads Ofz's owner, runtime epoch and intent instead of regranting the original owner. Human
resume and sleep commands commit in Ofz before the controller projects them. The BFF preserves the operation ID and
payload across retries. Removal denies access immediately but keeps quota until the controller proves the bound home
is absent and commits `CompleteWorkspaceRemoval` with the exact home UID and reservation.

Checks have a two-second deadline and no positive permission cache. Open streams and preview/terminal WebSockets
retain their original receipt-backed access chain, recheck every second and close on denial or authority failure.
Preview HTTP requests recheck before forwarding and after response headers, then guard the response stream with that
same chain. Observer operations do not renew idle activity.
`/readyz` requires Kubernetes, Ofz's unfenced and archive-healthy state, and shared SQL availability.

Run `bash services/tengri/test-runtime.sh` for real TLS PostgreSQL 18.6 and SpiceDB 1.56.2 fixtures. It exercises
replica-wide redemption/replay, preview binding and rotation, capacity/expiry, leadership CAS and lease expiry,
supervisor SQL restrictions and protected cleanup. `bash services/ofz/test-control.sh` additionally proves typed
reservation/runtime reads and the two-stage removal contract. For native KVM acceptance, set the documented image,
output and sample variables and run `bash services/ofz/test-control.sh kvm`; this provisions the real shared SQL
fixture and invokes `test-kvm.sh`. Unit fixtures do not establish production authority or fleet acceptance.

These source contracts are held behind `TENGRI_PREPARED_SLOT_CUTOVER_READY=false` until the coordinated release.
See [implementation status](../../docs/tengri/ofz-implementation-status.md) for the remaining production gates.

## Lifecycle settings and delivery

System Settings → Lifecycle controls `spec.power.idleTimeoutMinutes`. The default is 60 minutes, values through 1440
are accepted, and zero disables automatic sleep. Manual sleep always releases resident guest RAM. Changing the timeout
starts a new idle interval; authenticated activity extends it. Retained homes have no expiry or automatic deletion deadline.

The authorization cutover requires the reviewed Ofz API, shared TLS control database, separate workload roles,
exact-peer SPIFFE registrations and coordinated BFF signing-key rotation. The owner authorized deleting the existing
workspaces and homes for this cutover; they were removed on 2026-10-13. The temporary `tengri-ofz-cutover` admission
policy and binding prevent old-contract creation until the new authority is deployed. Remove both after verifying
the new dependencies and images, then prove fresh workspace creation. Runtime readiness, a healthy Argo Application, and unit tests do not
replace live allow/deny, stream revocation, recovery, history and fleet qualification.

Normal delivery uses the paired image publisher, Kargo, and Argo. Native AMD64/ARM64 guest artifacts contain the
checksummed kernel/root disk. The controller image also supplies the host runner, supervisor, TAP script, and pinned
Firecracker. Keep the paired source revision and immutable image digests together. Withhold discoverable Kargo aliases
until real KVM acceptance passes. See the [operations runbook](../../docs/tengri/operations.md) for the permission
review, fresh-workspace acceptance, release boundary, and recovery procedure. Do not run historical node-mutating spikes.

## Validation

```bash
cargo fmt --manifest-path services/tengri/Cargo.toml --check
cargo clippy --manifest-path services/tengri/Cargo.toml --locked --all-targets -- -D warnings
cargo test --manifest-path services/tengri/Cargo.toml --locked --all-targets
bash services/tengri/test-rpc-interop.sh
cargo run --manifest-path services/tengri/Cargo.toml --locked --quiet --bin crdgen > /tmp/tengri-crd.yaml
diff -u /tmp/tengri-crd.yaml services/tengri/crd.yaml
diff -u /tmp/tengri-crd.yaml argocd/applications/tengri/crd.yaml
shellcheck services/tengri/network.sh services/tengri/test-kvm*.sh
```

The ignored Linux KVM test requires explicitly authorized device grants and native paired boot/test images.
The AMD64 PR image jobs retain `tengri-kvm-fixture-tengri-amd64` and
`tengri-kvm-fixture-nanoagent-amd64` artifacts. Download both from the same workflow run and merge their contents into
one directory. Check both `*-SHA256SUMS` files there, then load both `*-images.tar.gz` archives with `docker load`.
The JSON receipts record the PR head, checked-out build revision, image reference, and saved image configuration digest.
Verify that both receipts match the requested PR head and build revision, and that the loaded configurations match
`configDigest`. Docker's containerd image store can report an image index as its image ID; the configuration digest
remains the same after loading the archive into a classic image store.
CI builds these artifacts without executing the KVM fixture. It requires no SSH devbox. Device execution still
requires the scoped approval below.
Frontend-only PRs do not run this image workflow. Runtime PR fixture builds import the same main-only registry caches
as the native images, including the KVM harness cache, to reuse the release compilation.
Native image builds for same-repository PRs also import and export `cache-pr-<number>-<architecture>` per service.
Later edits reuse that PR's compiled layers. Main builds import and export only their existing main cache; fork PRs
export no registry cache. These cache tags remain outside Kargo image discovery.
`TENGRI_KVM_TEST_IMAGE`, `TENGRI_KVM_GUEST_IMAGE`, `TENGRI_KVM_OUTPUT`, `TENGRI_KVM_SECCOMP`, and `TENGRI_KVM_SAMPLES`
select the artifacts, absolute local result directory, native OCI seccomp profile, and sample count for
`bash services/tengri/test-kvm.sh`. The retained Tengri fixture includes the native `runner-seccomp.json` profile.
The guest receives a separate resolver file. Docker's network resolver at `127.0.0.11` stays in the fixture container
for shared SQL discovery; copying it into the VM would send DNS requests to the guest's own loopback.
Routine main publication runs
three real sleep/resume cycles on each architecture. Every resume must finish below one second, and publication still
requires file and same-shell continuity, initialized Codex, host identity rotation, VMM termination, snapshot page
eviction, guest administration, and browser startup. It also requires terminal first output below 300 ms, managed
Neovim first screen below one second, and 50 heartbeat samples with p95 below 100 ms during eight seconds of guest
disk writes and flushes. It checks io_uring worker bounds, cgroup attribution and the PID limit, then injects a read
error into only the disposable fixture home disk and requires the guest to report it while remaining responsive.
The first sleep lasts three minutes so the previous host SVID
expires before restore. These are lifecycle smoke checks, not a measured latency distribution. Receipts include
`validationMode: smoke` and omit a p95 value until at least 50 samples are collected.
Resume replies report monotonic time spent after applying the host clock. The host excludes that readiness work
when bounding clock-transfer delay, and repeats the same idempotent resume if the timestamp arrived too late.
Missing or inconsistent clock timing rejects the resume; the controller and guest images must be promoted together.
The fixture checks that its binary contains the exact native lifecycle test before configuring devices. A successful
container exit also requires a nonempty `result.json`; an empty test selection cannot qualify an image for publication.

The native terminal probe answers foreground/background color queries and the device-status barrier used by the
pinned Neovim startup. Query parsing retains split sequences. Editor readiness requires a marker rendered in the
managed editor's buffer, rather than a separate stderr message. The command constructs the marker from character
codes so shell echo cannot satisfy the probe. The one-second screen limit and all other performance limits remain unchanged.

For deliberate performance qualification, dispatch **Tengri images** with `kvm_samples=50`, or set
`TENGRI_KVM_SAMPLES=50` when running the isolated fixture. This retains the p95 below one second benchmark. Runtime
and fixture builds share the Dockerfile's real-source release compilation. The runtime runs all release unit tests and
retains the exact native test binary in its build stage. The `kvm-test` target copies that binary from the same stage;
the production runtime excludes fixture binaries. Native validation imports the runtime's main-only registry cache,
so it does not compile Tengri again when the cache is available. Cache exports are best effort;
BuildKit reports export errors without canceling required image publication
or native validation. Fixture cache and test-binary tags are excluded from Kargo discovery.

The fixture uses a private Docker
network/PID namespace, the production four-CPU quota, 9 GiB memory, only KVM/TUN and startup NET_ADMIN/SETUID/SETGID, and no host data mounts. It verifies and records the cgroup CPU quota before booting the guest.
It checks real files, the same PTY shell, initialized Codex, stop/page-eviction, and rotating host identities, preserving
diagnostics before cleaning only its own resources. Its report states the boundary and exclusions. One prepared
creation and repeated slot resumes do not prove the full authenticated BFF/Kubernetes creation distribution or six
concurrent guests.

## Editor sessions

`IssueEditorSession(agent_id, window_id)` authorizes the owner, starts the guest workbench, and returns an ordinary
preview launch ticket for virtual port 13337. Its DNS-safe origin derives from owner, agent, CR UID, and desktop window
identity, so reload restores the native workspace and backups while another owner, incarnation, or window gets another
origin. Session cookies expire after 24 hours. The one-use launch token is also the revocation generation: a delayed
cleanup cannot revoke a replacement session on the same origin. Generic preview revocation retains its existing behavior.
Before sign-out clears authentication, `RevokeEditorSessions` removes every pending and active Chrome and editor lease for the
authenticated owner. A revocation failure blocks sign-out so it can be retried. The gateway also closes established
preview WebSockets within one second of session revocation or expiry.

The gateway injects the desktop integration script only into the workbench document. Native Markdown and extension
webviews retain their own HTML and CSP; editor frame ancestors allow both the issued origin and desktop origin.
Packaged assets under an exact upstream revision are compressed and privately cached. Workspace resources, HTML,
tickets, and integration scripts remain uncached. The private extension bridge binds its session query to the
cookie-authenticated preview origin. Ordinary preview sessions cannot select either reserved editor port.

Codex `SendCodexInput` and `SteerCodexInput` RPCs accept text, PNG/JPEG/WebP image bytes, or both.
These replace the former turn-input RPCs. A controller with the old contract rejects the new RPCs before
starting or steering a turn, preventing silent image loss during a mismatched release. Image inputs are limited to four,
4 MiB each, and 8 MiB total. Tengri verifies media signatures, writes the images into the owned retained guest
under `/workspace/.tengri-attachments` through gRPC, and submits Codex `localImage` inputs. A failed image write
fails the request before Codex starts or steers a turn. Attachments remain with the persistent workspace so saved
conversation references remain valid.
If a batch write fails, Tengri attempts to remove its unsent files, including a partially committed failed write.
Create-only conflicts preserve the existing file. Cleanup failures are logged while the original upload error is retained.

## Error reporting and request traces

Production sends sanitized errors to the existing GlitchTip `proompteng` organization and OTLP traces to Tempo.
The browser, BFF, Tengri host, Ofz, and Nanoagent have separate GlitchTip projects. W3C trace context crosses the BFF,
Ofz, controller, supervisor and guest request boundaries; HTTP failures return `x-trace-id`. Request spans and SQL
pool, leadership, replay, policy-read and audit spans contain operation names and timings. Trace resource
`service.version` and GlitchTip release identify the source revision baked into the image.
Private lifecycle commands propagate W3C `traceparent` to the root guest helper. Host spans separate vsock connection,
command send and reply wait; joined guest spans separate clock synchronization, filesystem thaw, API and terminal
readiness. The existing clock-transfer and readiness limits remain enforced.

RPC span names come from the compiled protobuf descriptors. Unknown request paths and dynamic Rust tracing fields
are excluded from export. Trace attributes retain only operation names, database system, standard HTTP methods,
response status and SQLSTATE; event messages and error descriptions are withheld. GlitchTip captures errors, while
routine warnings such as graceful shutdown remain in logs.

Telemetry excludes request bodies, cookies, tokens, actor identifiers, prompts, terminal output and file contents.
GlitchTip messages are withheld; source locations, error classes, SQLSTATE and trace IDs remain. Browser ingestion
accepts only bounded same-origin error envelopes for the configured project. It rebuilds the event and authoritative
release before forwarding to the fixed private collector. Attachments, replay, sessions and arbitrary destinations
are rejected. Repeated browser transport failures are limited to one event per operation/status per minute.

The reviewed ConfigMaps supply the public ingest DSNs and private OTLP endpoint. Network policies allow only
GlitchTip web TCP 8000 and Tempo distributor TCP 4318. The guest firewall additionally allows only the two resolved
collector service addresses and ports; other private networks remain denied. Newly prepared slots receive the
configuration through the private guest boot file, without database credentials or a Kubernetes identity.
Existing active guests need an explicitly fenced cold replacement retaining their home to install the new guest SDK;
a supervisor image restart alone does not update the guest root or runner environment.

RPC failures retain their numeric `rpc.grpc.status_code` in Tempo. GlitchTip events also carry a bounded
`grpc_code` tag and a status-specific title. Expected cancellation, validation, missing-resource, precondition and
authorization rejections remain visible in traces and logs without creating server-error issues. Transport failures,
server deadlines, capacity failures and internal errors still create error events. Spare-slot maintenance allows at
most two minutes from Pod creation for networking and initial container status. Within that bound it waits for the
supervisor's replay startup fence plus readiness timeout before probing. Failed containers, changed Pod identities
and failures after either startup window still surface.

After the normal release and promotion, run `tengri telemetry-check` in a controller and `ofz telemetry-check` in an
Ofz API Pod. Each emits one synthetic error and trace, flushes both exporters, and prints their IDs and source revision.
Verify those exact IDs in GlitchTip and Tempo. Exporter flush alone is not proof of ingestion. Then exercise real
browser, chat, terminal, editor and Chrome requests and verify joined traces and stable streams.

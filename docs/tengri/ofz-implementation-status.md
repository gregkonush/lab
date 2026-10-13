# Ofz implementation status

The goal is the complete migration and deployed acceptance described in
[the authorization plan](ofz-enterprise-authorization-plan.md). Work proceeds through dependent PRs, without subagents.
Production keeps its current authority until the coordinated hard cutover. New code has no legacy authorization fallback.

Completion requires the exact deployed release, every service's allow/deny/revocation and failure checks, fresh-workspace
product acceptance, independent restore and the required soak. On 2026-10-13 the owner explicitly replaced retained-data
migration with deletion of the old workspaces and homes. Migration rehearsals and legacy-data import are no longer
requirements. Published source and passing fixtures are intermediate evidence.

The service split is published in the native GitHub stack beginning at [#14908](https://github.com/proompteng/lab/pull/14908).

| Service or contract                      | Reviewable implementation                              | Deployed acceptance                         |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| Ofz lifecycle and control                | [#14908](https://github.com/proompteng/lab/pull/14908) | Pending cutover                             |
| Tengri controller, runner and supervisor | [#14915](https://github.com/proompteng/lab/pull/14915) | Pending cutover                             |
| Landing BFF and desktop authority        | [#14915](https://github.com/proompteng/lab/pull/14915) | Pending cutover                             |
| Ofz, Keycloak and application HA         | [#14909](https://github.com/proompteng/lab/pull/14909) | Pending cutover and fault probes            |
| Physical database promotion proof        | [#14910](https://github.com/proompteng/lab/pull/14910) | Pending native CNPG and independent restore |
| Runtime epoch and preview binding        | [#14911](https://github.com/proompteng/lab/pull/14911) | Pending cutover                             |
| Signed guest enforcement                 | [#14913](https://github.com/proompteng/lab/pull/14913) | Pending native KVM and execution fencing    |
| Ofz Viewer policy                        | [#14920](https://github.com/proompteng/lab/pull/14920) | Pending bounded observers and cutover       |
| Landing Viewer administration            | [#14921](https://github.com/proompteng/lab/pull/14921) | Pending bounded observers and cutover       |
| Exact-target guest proof protocol        | [#14923](https://github.com/proompteng/lab/pull/14923) | Pending cutover                             |

PR #14915 merged at `e4298be7be5afe2ab94300f003d6a2b31ef634a6` with its applicable PR checks passing.
Its matching BFF and desktop changes include the original application scope of #14916. The rebased #14916 retains
the signing-key documentation correction, fixes the identity fixture's cold-build timeout, and addresses its remaining
review findings about stale creation records and deletion of failed workspaces. Both findings reproduced in focused
regressions; stale creation also reproduced in Chromium with browser storage preserved across reload. The failing main run
compiled Tengri inside the browser's three-minute deadline; compilation now precedes that clock.
The new Ofz API and rollout credentials are still absent from the cluster. Publication remains held with
`TENGRI_PREPARED_SLOT_CUTOVER_READY=false`, and the temporary creation fence remains active.

The main Tengri image run built all four native images, then failed KVM qualification on both architectures during
guest DNS resolution. Docker's `127.0.0.11` stub was copied into the guest. #14916 gives the guest a separate resolver
file while preserving Docker DNS for the shared SQL fixture. A real Docker reproduction confirmed the stub, and both
ARC architectures resolved the bootstrap host through the configured public resolvers. The launcher regression passes;
both native KVM qualifications must pass on the new main revision before publication or cutover.

PR #14916 merged as `e89e1362f3248173bef4fdc15e860fdb39c6f495` after its checks and automatic review passed.
Main Ofz identity qualification now passes, and all four native controller/guest images built. Native KVM acceptance
and the coordinated service cutover remain release gates. ARM64 KVM passed on that revision with a 664 ms maximum
resume; AMD64 passed its functional checks but failed its first cold resume at 1,429 ms against the 1,000 ms limit.
The new HA main revision requires its own native qualifications.

PR #14909 merged at `464a773c35cc900fbd99dd63c7d6ab2359cc7cc4` after its applicable CI and automatic review passed.
The HA layer preserves the merged credentials and post-DNAT ingress paths. Its four prepared targets
render 65 resources, pass schema validation and Kubernetes server-side dry run, and reject 13 deliberately invalid
HA/credential/network configurations. The target uses the active generated CRD, removing the unused preparation copy.
Two consecutive real Keycloak/Ofz/controller browser runs pass 60 assertions in 68 and 66 seconds. They preserve the
same authenticated subject and credentials after serving-process loss, including an in-flight passkey challenge.
An earlier fixture stalled in a mocked Kubernetes exchange; the fixture now reports early handler completion instead
of silently waiting for a request that can no longer arrive. Rust units/Clippy and CI routing/release tests pass.
These are isolated source checks. Native database failover, deployed node loss, independent recovery and cutover remain
unqualified. NUC access works through the existing SSH identity; its independent filesystem has about 63 GiB free.

Source delivery continues through required CI and automatic review. Production remains held until the reviewed Ofz,
BFF, runtime, guest, migration and broker contracts can activate together. Remaining implementation includes bounded
observers, independent execution fencing, diagnostic proof keys and brokers, offboarding and independent recovery.
P8 requires real custodian enrollment, coordinated GitOps activation and fresh-workspace acceptance.

The 2026-10-11 delivery checkpoint rebases all ten layers onto current main while preserving the runtime performance
changes. The assembled runtime passes Rust units/contracts, Clippy, 23 real shared-database tests and Rust-Go RPC
interoperability. Cached transports carry no user authority; a regression verifies separate users, revocation and Ofz
loss on one reused connection. The independently checked Ofz root layer passes 50 control commands and 125 immutable
receipts in 145.04 seconds, 52 real browser assertions in 111.76 seconds, 297 Landing unit tests, TypeScript, lint and
22 operation-inventory regressions. Its fixture now acknowledges the synthetic outbox and sequence, gives new valid
roster reads fresh deadlines, and allows bounded cold Keycloak startup and cleanup. Production deadlines are unchanged.
These are source checks. Remote CI, reviewed merge and deployed acceptance remain separate gates.

- [x] Read repository instructions and Poteto principles; refresh source and runtime baseline.
- [x] Verify the requested administrator: `gregkonush`, GitHub numeric ID `12027037`.
- [x] Verify the second administrator/custodian: `tuslagch`, GitHub numeric ID `241203724`.
- [x] Identify the requested independent recovery host: `nuc.ide-newton.ts.net`.
- [x] P1: final schema, typed API, action inventory, real SpiceDB role/expiry/revocation tests.
- [x] P2 source and isolated control proof: Ofz service, durable commands, quotas, audit and database migrations.
- [x] P3 source and isolated browser proof: Keycloak identity, shared sessions and Access UI.
- [ ] P4: shared tickets, leadership and failover.
- [ ] P5: enforce every runtime channel and add pure observers.
- [ ] P6: proof-bound diagnostic grants, Kubernetes and connector brokers.
- [ ] P7: offboarding, independent archive/backups and isolated restore.
- [x] P8 deletion: old MicroVMs, homes, guest Pods, slot Leases and old workspace grants removed; creation fenced.
- [ ] P8 delivery: reviewed release, hard cutover and fresh-workspace product acceptance.

Both required custodians are named and their numeric identities verified. NUC has approximately 63 GiB free at the
initial readback, below the 192 GiB uncompressed home-storage ceiling. Database recovery and home recovery must each
be qualified against actual retained data and available space.

Evidence and decisions are recorded in [the implementation trail](ofz-implementation-decisions.tsv).

P1 local evidence: 492 permission assertions against pinned SpiceDB and PostgreSQL; five Rust contract tests; five
inventory tests including deliberately unclassified RPC and HTTP changes; Buf lint; Clippy; Rust/Python/shell checks.
The catalog covers 163 current operations across eleven surfaces, including each HTTP method and Axum's implicit HEAD.
Delegation checks bind the recorded issuer and
workspace, including wrong-workspace replay and missing-binding denial. HTTP inventory covers both Go registration
APIs across every guest source file. This is contract proof, with runtime enforcement
and production qualification still pending. Native dispatch caching failed the expiration probe and remains disabled
in the qualification fixture; the release must preserve that setting.

P2 local evidence: the nine-RPC Rust service and TLS-only control database passed Clippy and the unit/contract suite.
The isolated PostgreSQL/SpiceDB control fixture passed with 16 committed commands and 41 immutable audit receipts.
It exercises crash recovery before native writes, after native writes and after SQL receipts; lost responses; version and
operation conflicts; concurrent quota reservations; minimum-administrator protection; independent emergency approvals;
hash-only show-once grants; expiry and issuer revocation; exact stream context; native/journal/archive failure; and
ownership quarantine before native transfer and before receipt recovery. The policy fixture now checks 509 assertions.
The prepared seven-resource control-plane configuration passed Kubernetes server-side dry run and remains excluded
from active GitOps. Real BFF/Ofz mTLS interoperability, OIDC sessions, fleet enforcement and deployment remain later gates.

P2 review regressions additionally passed against local PostgreSQL 18.1 and the checksum-verified official SpiceDB
1.56.2 Darwin ARM64 binary: 21 commands and 60 immutable receipts, including repeated roles, controller administration
and human-read denial, emergency roster visibility and removal across readmission, control-only idle extension,
idempotent logout and establishment recovery, rejection of live runtime epoch replacement, and archive backlog
fencing despite a fresh heartbeat or a failure during a native check. Each of the three latest behavioral regressions
fails with its previous implementation and passes after the fix. Additional regressions reject single-factor privileged
reads and controller enrollment while the archive is unhealthy, and pass with an older verified passkey for ordinary
policy/audit reads. The current policy fixture passes 587
assertions. The exact pinned PostgreSQL 18.6 and SpiceDB container fixture also passed on NUC with 21 commands and
60 immutable receipts. Operational test grants remain live throughout remote offboarding checks; expiry is tested
separately. The in-flight archive race has a bounded barrier timeout. NUC access uses the same existing key, whose
fingerprint matches the configured SSH agent, without changing the account or credential identity.

P3 local evidence: Keycloak 26.7.3 with Java 21, real TLS PostgreSQL 18.1, SpiceDB 1.56.2, Ofz and the BFF passed the
isolated Chromium fixture with a synthetic GitHub upstream and virtual user-verified passkeys. The fixture checks
duplicate-email identity separation, admission denial with an immutable receipt, browser membership/quota changes,
the two-administrator minimum, stale MFA rejection, fresh passkey step-up, downgraded assurance rejection, atomic
session-cookie replacement, shared SQL inspection, logout revocation and HEAD/replay rejection. The Landing suite
passed 296 tests. The current control fixture passed 26 commands and 79 immutable receipts. The expanded browser fixture
passes 44 assertions under pinned Bun 1.4.2, including permission checks before external identity resolution and real
GitHub/BFF credential rotation without replacing users or passkeys. A simulated lost response after real session
establishment recovers the same credential with one session and one successful audit receipt; disabling BFF recovery
fails the actual browser flow. Command preflight remains available for revocation
under archive loss and never renews idle activity. Both the 26-command control fixture and the 44-assertion browser
fixture also passed against the exact PostgreSQL 18.6 and SpiceDB containers on NUC. Twenty-two inventory regressions,
TypeScript, type-aware lint, generated-client verification and strict prepared-manifest validation passed after
restacking onto current main. The corrected dependency hashes passed native Linux image builds on both architectures
at commit `371f53f7a2`; all required CI checks passed there. The emergency-access catalog classification was then aligned
with the enforced administrator permission and covered by the Rust contract suite. Logout now classifies its actual
session-revocation action. The pinned identity fixture passed all 44 assertions again after waiting for Keycloak's
deferred WebAuthn module before clicking its registration and authentication buttons. Real custodian enrollment and
deployed product proof remain later gates.

The follow-up command-recovery fixture passed 52 browser assertions and 297 Landing tests. It commits a self-demotion,
loses the successful response, and recovers the original receipt after administrator authority is gone without another
GitHub lookup. A changed request with that operation ID returns 409. Ofz binds this recovery to the original validated
BFF request hash; the real 26-command / 79-receipt control fixture also verifies recovery after ownership transfer and
hash collision rejection. Cancelled OIDC callbacks clear their attempt cookie; that regression returns 400 against the
prior source and the required 401 with the fix. Eight Rust units, Clippy, TypeScript and 22 inventory regressions pass.

The coordinated cutover gate also covers the Proompteng image: Kargo discovery remains withheld while
`TENGRI_PREPARED_SLOT_CUTOVER_READY` is false. This was verified against the repository variable and workflow input;
the production BFF remains on its previous image. Rate limits use the connection peer, so clients reaching the
LoadBalancer cannot choose buckets with proxy headers. Tunnel clients share the tunnel Pod's bucket. An isolated
Traefik 3.7.13 fixture on NUC reproduced seven admitted requests with rotating headers under the previous configuration
and returned HTTP 429 on the seventh request under the corrected configuration. This is isolated ingress proof;
production ingress acceptance remains part of P8. Fifty-seven focused inventory, rollout and ingress checks pass.
The enabled-app inventory follows declared nested Kustomize inputs, excluding prepared directories until referenced;
only Ofz's classification changed in the current repository inventory.

## PR 14915 review correction

PR #14908 merged as `b06b8baa3d73af4ba8cd52d0ec3871990797e84c`. The new Ofz API remains excluded from the
production kustomization. This merge does not establish production authorization or complete the migration.

PR #14915 now includes its matching BFF consumers. Moving signed-context metadata, reservation creation and Ofz
lifecycle commands out of the later Landing layer makes the breaking runtime contract reviewable together. The
controller and BFF credentials and required network paths are wired in complete cutover overlays, excluded from active
applications until the Ofz and credential dependencies exist. The active quota reserves the seventh election Lease.
Fixture fixes use the real shared TLS database and canonical opaque preview tickets.

CI compares the generated schema with the active CRD as well as its preparation copy. The owner authorized deleting
both old workspaces and their homes on 2026-10-13. Their controller finalizers stopped the guests and removed the
MicroVMs, guest Pods, home PVCs and slot Leases. Both reclaim-policy `Delete` PVs are gone. A fully consistent SpiceDB
read returned zero `tengri_workspace` relationships. No existing workspace needs reservation/epoch enrollment.

The temporary `tengri-ofz-cutover` ValidatingAdmissionPolicy and binding reject MicroVM creation only in `tengri`.
A server-side dry-run verified the denial. Keep this fence until the new authority and required dependencies are
running, then remove both objects and prove fresh workspace creation. Four unused prepared homes belong to the pool,
not to deleted users; pool retirement remains the controller's responsibility during image replacement.

This removes the retained-data migration blocker. The new Ofz API is not yet deployed, and the image publication hold
remains false. This deletion does not establish deployment or acceptance of the new authorization contract.

The isolated physical-promotion fixture passes against pinned PostgreSQL 18.6 and SpiceDB. A physical base backup
includes the native datastore, Ofz control tables and shared runtime state. The fixture requires synchronous streaming,
kills the original primary, and promotes the standby at the same service address. The 2026-10-13 control fixture commits
50 commands and 125 immutable receipts. Existing clients recover in 2.94 seconds
and deny a consumed nonce before its original five-second expiry. Atomic pending/spent tickets, live/revoked previews,
session/workspace/runtime bindings, unique leader acquisition and stale-fence denial all pass. Owner access stays allowed
and a revoked viewer stays denied; every Ofz control table has the same hash before and after promotion. The initial run
exposed Docker's requirement for an explicit subnet when reassigning an IP, which the fixture now provisions. The test
runs once in Ofz CI, replacing the separate control-only run, and requires the exact promotion test to pass. An empty
test selection fails qualification. Shared runtime validation stays in the Tengri image workflow. This two-node fixture does not prove three-node CNPG or Kubernetes recovery, independent backups, or
post-failure synchronous write availability. Those deployed/recovery gates remain open.

The runtime-epoch layer separates persistent slot allocation from executing runtime identity. Claims require a
canonical Ofz runtime UUID, and guest transports require exactly one current binding header for every identity field.
Reconciliation stops an older runtime before restoring under fresh authority; a frozen guest can change runtime only
within the same physical allocation. Never-started workspaces retain storage without inventing an executing runtime.
Requalification on main `5d9184e568` passed 135 Rust tests, three generated-CRD tests, all-target Clippy, 23 real TLS
PostgreSQL/SpiceDB runtime tests, Rust/Go file-Codex-terminal interoperability and BFF identity/SVID renewal, and the
native Linux/ARM64 guest suite. The Linux runtime-binding test also passed by exact selection. This includes the
newly merged shared HTTP/2 fixture with its required runtime epoch. Native KVM, signed guest actions, bounded observers,
independent execution fencing and deployed acceptance remain separate requirements.

The API image factory merged in #14985 at `844d149ff29dc884290e19241645926d8cee3bda`. Its successful main run
`38397202365` published both architectures and the immutable alias
`kargo-sha-844d149ff29dc884290e19241645926d8cee3bda-run-38397202365`. Registry readback matches the release receipt:
`registry.ide-newton.ts.net/lab/ofz@sha256:05cd35b48a1ce68085705167fe91a495d4c5635cddf1bd947412066b16e0e71a`.
API activation still needs the reviewed credentials, initialization, independent archive and delivery enrollment.
Runtime epoch #14911 then merged through GitHub's native asynchronous stack API at
`fe2acf427ab4ec53733a4960fc9af1d5f67e8727`, with its applicable checks green and no actionable open findings.

The next signed guest layer binds actor, full claim, leader fence, recovery generation, action, exact target and payload,
scope, deadline and nonce. Controllers retain the Ed25519 seed; supervisors and guests receive the public bundle.
Supervisors consume proof nonces in shared SQL before forwarding. Rust/Go wire interoperability, native Linux guest
race tests and vet, 141 runtime tests, three CRD tests and eleven authorization contract tests pass. The final native
Linux/ARM64 release build also passes 142 runtime tests, three CRD tests and eleven contracts. All 25 real shared
SQL tests pass, including one-use proofs across supervisors. The real control fixture passes 50 commands and 132 receipts;
587 policy assertions, 22 inventory regressions, four prepared HA renders with 15 rejected regressions, and all 332 BFF
unit tests and TypeScript pass. The Chromium/Keycloak/SPIFFE/SQL fixture passes 60 assertions, including both serving
Ofz loss and Keycloak loss during a passkey challenge. Identities in this isolated fixture remain synthetic.

Browser qualification reproduced a fresh signed creation rejected by the independent replay database's future bound.
A deterministic 500 ms clock-lead regression failed before the fix. The SQL guard now allows at most one second of
lead, reads its clock after acquiring the replay lock, and retains the exact signed expiry. The authenticator still
rejects deadlines outside five seconds, including the new 5.5-second signed regression; expired and replayed requests
remain rejected. The fixed browser and shared-state suites pass without relaxing their product or recovery deadlines.

Two isolated NUC memory-advice probes completed functional guest checks across three sleep/resume cycles. Random-read
advice reduced first-resume reads from 347 MB to 27 MB in the sampled baseline comparison. Resetting normal readahead
before full capture avoids the first probe's small-read penalty. The second probe still fails latency qualification:
creation is 1.66 seconds and the slowest resume is 1.24 seconds. The release candidate records the change as
`1.16.1+tengri-async-io.3`; its two upstream memory-dump tests pass. Both native release performance gates remain required.
The new SQL checksum also passes synchronous physical promotion: unchanged clients recover in 2.84 seconds, the
original five-second nonce stays consumed, and all 18 Ofz control-table hashes match. The final native Linux check
initially hit the local Docker disk limit; removing only this task's compiler image and its identified cache record
freed 2.15 GB, and the cache-only recheck passes.
Bounded observers, independent execution fencing, brokers, independent recovery and the deployed cutover remain open.

The signed guest review reproduced terminal ticket issuance and termination denied before reaching Nanoagent.
The same parent-operation assumption also affected Codex thread operations and image staging. Guest admission now
requires the original controller operation and a fresh exact guest action/target decision when they differ. The
sub-operation has its own audit receipt and cannot outlive the parent decision; actor, runtime and recovery bindings
remain unchanged. Permission for only the parent or only the sub-operation is insufficient. No compatibility path was added.
The corrected controller paths and signed guest proofs pass all 26 local shared-database tests. The real Ofz/SPIFFE
browser fixture passes 60 assertions in 66.97 seconds, including renewal after the original preview deadline.
The added wire check keeps its existing revocation watcher polled while checking renewed authority, avoiding a
fixture-only mutex stall. Rust now passes 142 runtime tests, three CRD tests, eleven signed contracts and Clippy;
real Rust/Go interoperability passes. Current native builds and deployed acceptance remain separate requirements.
The complete NUC runtime rerun passes all 26 tests in 81.81 seconds, with unchanged deadlines and capacity assertions.
Two earlier remote runs returned unavailable in the capacity test; the isolated probe and final complete run pass, but
the earlier connection failure was not diagnosed. Database pool failures now retain their internal error in server logs
while returning the same bounded unavailable response.

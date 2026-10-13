# Ofz implementation status

The goal is the complete migration and deployed acceptance described in
[the authorization plan](ofz-enterprise-authorization-plan.md). Work proceeds through dependent PRs, without subagents.
Production keeps its current authority until the coordinated hard cutover. New code has no legacy authorization fallback.

Completion requires the exact deployed release, every service's allow/deny/revocation and failure checks, fresh-workspace
product acceptance, independent restore and the required soak. On 2026-10-13 the owner explicitly replaced retained-data
migration with deletion of the old workspaces and homes. Migration rehearsals and legacy-data import are no longer
requirements. Published source and passing fixtures are intermediate evidence.

The service split is published in native GitHub stack [#14917](https://github.com/proompteng/lab/pull/14908).

| Service or contract                      | Reviewable implementation                              | Deployed acceptance                         |
| ---------------------------------------- | ------------------------------------------------------ | ------------------------------------------- |
| Ofz lifecycle and control                | [#14908](https://github.com/proompteng/lab/pull/14908) | Pending cutover                             |
| Tengri controller, runner and supervisor | [#14915](https://github.com/proompteng/lab/pull/14915) | Pending cutover                             |
| Landing BFF and desktop authority        | [#14916](https://github.com/proompteng/lab/pull/14916) | Pending cutover                             |
| Ofz, Keycloak and application HA         | [#14909](https://github.com/proompteng/lab/pull/14909) | Pending cutover and fault probes            |
| Physical database promotion proof        | [#14910](https://github.com/proompteng/lab/pull/14910) | Pending native CNPG and independent restore |
| Runtime epoch and preview binding        | [#14911](https://github.com/proompteng/lab/pull/14911) | Pending cutover                             |
| Signed guest enforcement                 | [#14913](https://github.com/proompteng/lab/pull/14913) | Pending native KVM and execution fencing    |
| Ofz Viewer policy                        | [#14920](https://github.com/proompteng/lab/pull/14920) | Pending bounded observers and cutover       |
| Landing Viewer administration            | [#14921](https://github.com/proompteng/lab/pull/14921) | Pending bounded observers and cutover       |
| Exact-target guest proof protocol        | [#14923](https://github.com/proompteng/lab/pull/14923) | Pending cutover                             |

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

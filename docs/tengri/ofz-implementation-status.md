# Ofz implementation status

The migration is incomplete. The delivery target is [the enterprise authorization plan](ofz-enterprise-authorization-plan.md),
including deployed allow/deny/revocation, failure and failover checks, independent restore and the required soak.
Work proceeds directly, without subagents, through the existing native GitHub stack. Historical decisions and detailed
fixture evidence remain in [the implementation trail](ofz-implementation-decisions.tsv).

## Current release boundary

The active source frontier is [#14921](https://github.com/proompteng/lab/pull/14921), the Viewer administration UI.
Its policy dependency, [#14920](https://github.com/proompteng/lab/pull/14920), merged at
`70b513e03287b33af582520bb21671f4a99e92c2` after the exact published head passed CI, including both API and frontend
architectures and all four native Tengri/Nanoagent builds. The UI layer is rebased onto this merged policy. Its request
budget and target-administration fixes pass local and real browser qualification; the published head must pass CI before merge. Work
stays on this PR until it merges. Passing image builds do not establish native KVM performance or deployed authorization.

The 2026-10-13 live readback uses `galactic-tailscale`. Ofz has three SpiceDB replicas and two Playground replicas,
with three PostgreSQL Pods. There is no Ofz API Deployment and there are no Tengri MicroVMs. The
`tengri-ofz-cutover` admission binding remains active. The repository release variable
`TENGRI_PREPARED_SLOT_CUTOVER_READY` remains `false`.

The owner explicitly authorized deletion of the old workspaces and homes. That deletion is complete; retained-data
import and migration rehearsals are superseded. Retire the old unclaimed prepared pool and journals before activating
the new VMM/protocol. Fresh workspaces must use the final contract. No legacy authorization fallback is implemented.

## Service delivery

| Service or contract                                                               | Source delivery                                             | Remaining release boundary                                              |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Ofz lifecycle, quotas, durable policy commands, audit and admission               | #14908 merged                                               | Bootstrap, independent exporter, delivery enrollment and API activation |
| Tengri controller, runner and supervisor; Landing lifecycle and desktop authority | #14915 and #14916 merged                                    | Coordinated activation and fresh-workspace browser proof                |
| Replicated Ofz, Keycloak and application configuration                            | #14909 merged                                               | Live host loss and three-node CNPG qualification                        |
| Physical database promotion                                                       | #14910 merged                                               | Native CNPG and independent restore                                     |
| Allocation/runtime epoch and preview binding                                      | #14911 merged at `fe2acf427ab4ec53733a4960fc9af1d5f67e8727` | Coordinated runtime/guest activation                                    |
| API image factory                                                                 | #14985 merged at `844d149ff29dc884290e19241645926d8cee3bda` | Warehouse/Stage enrollment and API deployment                           |
| Signed guest and preview admission                                                | #14913 merged at `9bb95305b8dc72e7465fba35de6998714168a37b` | Native performance, independent execution fencing and activation        |
| Explicit Viewer scopes                                                            | #14920 merged at `70b513e03287b33af582520bb21671f4a99e92c2` | Bounded observers and coordinated activation                            |
| Viewer administration UI                                                          | #14921 is the only active PR                                | Current-head CI and deployed UI acceptance                              |
| Exact-target protocol 4                                                           | #14923 published; local continuation qualified              | Merge after #14921, native proof and coordinated activation             |
| Bounded file observers                                                            | Local implementation, unpublished                           | Finish controller/BFF wiring and full scoped acceptance                 |

The verified API factory receipt is main run `38397202365`. Its two-platform index is
`registry.ide-newton.ts.net/lab/ofz@sha256:05cd35b48a1ce68085705167fe91a495d4c5635cddf1bd947412066b16e0e71a`,
with immutable alias `kargo-sha-844d149ff29dc884290e19241645926d8cee3bda-run-38397202365`.
That receipt proves publication of the factory revision, not deployment or completion of later source changes.

## Current isolated evidence

- Signed admission passes 142 macOS runtime tests, three CRD tests, eleven signed contracts and Clippy. Go race/vet,
  native Linux guest checks, deterministic cross-language vectors and real Rust/Go RPC/SPIFFE interoperability pass.
- All 26 shared-runtime SQL tests pass locally and on NUC. The NUC full run takes 81.81 seconds. Earlier remote capacity
  failures were intermittent and their connection cause remains unconfirmed. Pool errors now retain internal context.
- Both terminal controller failures reproduce before the sub-operation correction. Admission now requires the original
  controller operation and an independently authorized exact guest action/target, with its own receipt and a deadline
  bounded by the parent. The proof covers terminal tickets/termination, Codex resume and image staging. Either permission
  alone, a changed workspace or a changed runtime cannot authorize the compound operation.
- The replay store accepts a verified five-second request when its clock lags by 500 ms. The SQL future bound allows
  one second of clock lead; signed five-second deadlines, exact expiry, replay and excessive-future denials remain intact.
- The maintenance archive race reproduces an allowed response carrying an immutable denial receipt. The correction
  compares final archive and fence state and records a terminal denial before aborting changed authority. Four real
  audit-lock races cover both directions of each flag. The full control fixture passes 50 commands and 141 receipts.
- Real Chromium, production Keycloak 26.7.4, Ofz, SPIFFE and SQL pass 60 assertions after the maintenance correction.
  Ofz serving-process loss preserves the session. Keycloak loss during a passkey challenge recovers within 30 seconds.
  These checks use synthetic GitHub identities and virtual passkeys.
- The Viewer policy continuation, rebased onto the maintenance correction, passes nine Ofz unit tests, Clippy and
  55 real control commands with 174 immutable receipts. Both pending-scope and in-flight narrowing regressions pass.
- The current Viewer UI passes 342 BFF/component tests, TypeScript, lint and 81 real browser assertions.
  It verifies metadata-only defaults, inline rejection before identity lookup, exact scopes, new-subject consent,
  narrowing, screenshot consent and content removal without starting the workspace. Encoded commands must fit the
  existing 64 KiB request budget, including escaping and metadata. Three regressions reproduce the prior size mismatch;
  the browser now rejects an oversized scope inline without an identity lookup or policy change.
  An accepted 64 KiB command also reproduced a late 429 from the private gRPC envelope caps. Both sender and decoder
  now allow 128 KiB envelopes; the real BFF-to-Ofz boundary command commits and its scope can be removed afterward.
  The browser also reproduces the old form's trimming of a whitespace-bearing file root, thread ID and terminal ID.
  Target splitting now preserves each nonempty line exactly; the complete fixture passes with those literal targets.
  The roster labels and quotes each target kind, distinguishes identical thread/terminal IDs, and does not advertise
  browser access on metadata-only diagnostic grants. Invalid Unicode that protobuf would replace is rejected.
  CI exposed a preview fixture reusing an expired context after earlier operations. It now creates a fresh five-second
  context at preview submission; production deadlines and the expired-submission denial remain unchanged. The latest
  combined browser proof passes after this correction, alongside 142 runtime units, three CRD tests and eleven contracts.
- The prepared protocol-4 continuation passes Rust units/contracts, Go race/vet on macOS and native Linux, real RPC/SPIFFE
  interoperability, deterministic vector parity and 26 shared SQL tests. Ofz retains the full scope; signed guest proofs
  carry one exact authorized target and output budget. Retired protocol-3 proofs remain rejected.
- Earlier physical promotion recovers unchanged clients in 2.84 seconds, preserves the unexpired consumed nonce and
  matches all 18 control-table hashes. The complete prepared HA renders validate 65 resources and reject 15 regressions.
  These isolated proofs do not establish deployed CNPG recovery or an independent restore.
- Demand-paged snapshot advice reduces sampled first-resume reads from 347 MB to 27 MB. Three functional NUC cycles
  preserve files, Codex, the terminal and zero-RAM sleep. Creation at 1.66 seconds and maximum resume at 1.24 seconds
  still fail the unchanged one-second target. Both native architectures, fifty-sample qualification and live acceptance
  remain required.
- The PR cache policy passes Actionlint and 57 routing/release contract tests. Same-repository PRs use separate
  `cache-pr-<number>-<architecture>` tags per service. Main retains its own cache. The first Nanoagent cache exports
  took about 25.5 minutes per architecture. Exported registry manifests are verified; warm reuse and any timing benefit
  remain unmeasured.

## Remaining implementation and cutover

- [ ] Complete bounded Files, Terminal, Codex, Browser and Preview observation through controller, BFF and guest handlers.
      Prove zero guest side effects, output budgets and timely revocation on every channel.
- [ ] Add an independent host execution deadline and prove guest/egress fencing within thirty seconds of authority loss.
- [ ] Complete proof-bound diagnostic credentials, shared DPoP replay, the agent adapter and restricted diagnostic routes.
- [ ] Deliver dedicated native Kubernetes RBAC and the scoped broker; verify effective permissions and real denied requests.
- [ ] Deliver the reviewed connector catalog, target/credential controls, destination validation and response budgets.
- [ ] Complete IdP offboarding, copied-credential rotation and clean-environment recovery for quarantined homes.
- [ ] Install independent immutable audit, database/home backups and restore on the approved NUC destination.
- [ ] Prepare protected bootstrap inputs for the two approved custodians and complete their real passkey enrollment.
- [ ] Enroll API/broker delivery, supply required credentials and activate the reviewed final contract through Kargo/Argo.
- [ ] Verify exact commits, images, schema and configuration; remove the creation fence only after cutover gates pass.
- [ ] Prove fresh-workspace product behavior, every service's allow/deny/revocation/failure matrix, independent restore,
      both native performance targets and the required mixed-workload soak.

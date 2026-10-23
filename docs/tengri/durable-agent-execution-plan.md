# Tengri durable agent execution

Status: The final guest API 7 cohort is deployed through Kargo and Argo at source
`bcc3e2105210b65c0aa8a2b20546ec1b2c492d9d`. Its retained-home replacement is prepared and filesystem continuity is
verified. Earlier-cohort authenticated run recovery passed. Final-cohort cancellation, approval, restart recovery,
and latency checks await normal saved-passkey sign-in. Goal `01a15d3d-a9f2-7320-a38a-473615e3425c` remains active.

The scope is the execution gaps identified in [the research](durable-agent-execution-research.md). It includes lost
submission responses, interrupted Codex processes, pending controls, workspace concurrency, active-run sleep,
deployment compatibility, and authoritative UI recovery. Ofz authorization and runtime fencing remain mandatory.

## Completion predicate

An authenticated user can submit one identified run, disconnect, recover its exact execution, resolve an exact pending
approval, and cancel it after controller or worker replacement. Duplicate submissions never dispatch duplicate turns.
Unknown shell or browser outcomes remain visible and block automatic replay. Automatic sleep cannot interrupt an
active run. The reviewed commit must pass required CI, publish immutable paired images, follow Kargo and Argo, and
pass authenticated live acceptance. Source, fixtures, merge, deployment, and product verification are separate gates.

## Execution units

| Unit | Contract                                                                                                                    | Evidence and state                                                                                                                                                |
| ---- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Stable operation IDs through browser, BFF, controller, and guest; dispatch journal and read-only acceptance reconciliation. | Concurrent duplicate, changed payload, lost response, process replacement, and pinned native Codex correlation fixtures passed. Production acceptance is pending. |
| 2    | Restate Rust worker outside the guest; durable accepted input, terminal outcomes, and workspace exclusion.                  | Disposable Restate 1.7.9 crash/replay and exclusion fixtures passed. Both production workers are ready and all three services are registered.                     |
| 3    | Identified approvals, steering, and cancellation with exact generation, scope, and fresh Ofz authority.                     | Duplicate and stale controls, restart, policy denial, and cancellation fixtures passed. Production acceptance is pending.                                         |
| 4    | Desktop recovery across retries and reloads; active work excludes automatic sleep.                                          | Browser recovery and idle-boundary regressions passed. Production acceptance is pending.                                                                          |
| 5    | One dispatch path, immutable worker versions, paired release, network isolation, and finite retention.                      | Consumer, manifest, and worker-version replay checks passed. The qualified cohort is deployed.                                                                    |
| 6    | Review, CI, merge, publication, Kargo, Argo, and authenticated acceptance.                                                  | Release gates passed. The remaining product checks below keep the goal open.                                                                                      |

## Execution contracts

The core identities are run ID, operation ID, workspace UID, runtime epoch, thread ID, turn ID, and approval ID.
A transport failure cannot create a fresh operation identity or imply that execution stopped. Run state distinguishes
accepted work, execution, pending controls, recovery, uncertain outcomes, and terminal outcomes.

Restate owns orchestration. Ofz and shared SQL retain authority and fencing. Nanoagent owns the exact Codex process
interaction. A separate versioned worker in the existing Rust codebase keeps durable execution independent of the
controller's elected reconciliation future. No independent SQL run scheduler or outbox competes with Restate.

The guest journal records uncertain dispatch rather than treating a local record and an external Codex request as
one transaction. Pinned Codex 0.159.2 persists `userMessage.clientId` and exposes metadata-only turn pages. Its native
fixture recovers the same accepted turn after removing the committed response receipt. Native terminal receipts bind
the outcome to the accepting process generation. A reconstructed history entry alone does not prove the outcome.

The active-run pin excludes automatic sleep. Explicit sleep, removal, and revocation retain Ofz authority.

Accepted runs acquire their sleep fence before guest availability is required. Preparation and native dispatch use
separate durable steps. A replay after possible native acceptance retains the original operation identity and
reconciles its outcome. It cannot reinterpret a changed image or expired authority as proof that no effect occurred.

Signed run and control attempts enter through retryable shared handlers on the workspace object. Signature
verification precedes either private workflow. A request rejected after key rotation does not consume its operation
UUID; a freshly signed retry can recover that operation. Accepted workflow and workspace-claim calls do not revalidate
an old envelope against a newly projected key.

Controls retain their exact approval scope and expose the original result on retry. The browser retires an identity
only after an exact `control_not_dispatched` response. Ambiguous failures keep that identity. Auto-approval waits for
an accepted run with a native turn. A stale approval generation cannot authorize another request.

Cancellation retains the latest authenticated Stop in the workspace object. A new login can supply fresh authority
after explicit sleep; an older delayed Stop cannot replace that context. Only the run workflow interrupts and
observes the exact turn. Snapshot sleep preserves running processes, so Stop remains pending until interruption is
confirmed. Workspace removal requires the final Ofz receipt; Kubernetes absence is insufficient.

The live cancellation check exposed a native Codex 0.159.2 distinction: `turn/interrupt` ends the turn while a yielded
`exec_command` process can continue. Guest API 7 requires Nanoagent's version 2 terminal receipt with confirmed
command cleanup. It records command item ownership before interruption, terminates only that turn's native background
terminals, and verifies their absence before releasing activity or the run's sleep pin. Interrupted history alone
retains cancellation. The pinned native fixture must prove that the real command exits. The API 7 migration requires
a fenced cold replacement retaining the current home, Codex identity, and conversation history before live acceptance.

Arbitrary shell or browser effects require authoritative readback or an explicit uncertain outcome. A workflow wrapper
cannot make every external action transactional. Automatic replay must stop when the outcome cannot be proved.

## Qualification and version retention

The disposable Restate fixture uses the pinned server and SDK, two registered worker versions, and actual worker
`SIGKILL`/restart. It covers duplicate and changed controls, workspace exclusion, newer Stop authority, queued signed
requests across HMAC rotation, and recovery under the same operation UUID. Its guest is sleeping. This proves
orchestration recovery, not recovery of an executing production shell command.

The final source passed the [desktop browser workflow](https://github.com/proompteng/lab/actions/runs/39848768010),
including the real Chromium/CUA/VS Code gates. Component fixtures cover Codex acceptance, runtime SQL contracts,
Rust/Go authorization transport, BFF identity replacement, and the automatic-sleep CAS boundary.

Restate retains versions with pinned invocations. The rollback history limit does not cap live draining versions.
The namespace allows six slots, three controller Pods including surge, and eight worker Pods. Limits including
sidecars are 42 CPU / 63 GiB; requests remain within 27 CPU / 57 GiB. Controller pools reserve at most 30 SQL
connections during surge, and eight workers use eight more, below the existing controller-role limit of 42.
Additional versions wait for a verified drain. Pinned workers and acceptance evidence cannot be force-deleted.

## Deployed cohort

The release observation at 2026-10-22 21:53 UTC matched the running images, generated GitOps revisions, registered
Restate worker, and retained slot to source `bcc3e2105210b65c0aa8a2b20546ec1b2c492d9d` and schema
`a0e81e7a9e92a191cbe80b79ddda7019ae2aaac7a90173f83515a2e82256bb9f`. Required source CI and the four main
publication workflows passed. [PR #15280](https://github.com/proompteng/lab/pull/15280) had 29 terminal successful or
skipped checks before merge. The image indexes and running architecture digests were read back independently.

| Image            | Immutable index digest                                                    | Publication                                                                        |
| ---------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `lab/tengri`     | `sha256:0227b465f8e30ac31ff3733b396d8bad044ac19e6e0e342dd71f3027b436b8b1` | [Tengri images](https://github.com/proompteng/lab/actions/runs/39848767998)        |
| `lab/nanoagent`  | `sha256:2f9e2cbc8c85249a1b52ece0ca472e17932ebc22c3e2f259c5a392a9fbe770dd` | [Paired native images](https://github.com/proompteng/lab/actions/runs/39848767998) |
| `lab/ofz`        | `sha256:ebdbedd44bea021b7ca816ac4b657d1f80fb5ac0d17a3673cbcbbe4e1cfeac66` | [Ofz authorization](https://github.com/proompteng/lab/actions/runs/39848768121)    |
| `lab/proompteng` | `sha256:9f1dbe38cf31dd1a53c7f846f1f1215150f0967c3763f2ba46d7d440b2165c7c` | [Product images](https://github.com/proompteng/lab/actions/runs/39848768178)       |

Both native architectures passed the unchanged lifecycle gates. The first final-source ARM64 attempt passed
functionality but failed the 1,000 ms maximum resume limit, with samples of 1,092, 1,005, and 828 ms. One controlled
failed-job retry passed, with prepared creation at 820 ms and three resume samples of 653, 654, and 707 ms. The failed
and successful attempt artifacts remain retained. The cause of the timing variation remains unproven.

These three-cycle results are smoke qualification. They cover the slot mTLS request through files, PTY, and initialized
Codex RPC. They exclude browser authentication, Kubernetes latency, raw PVC allocation, six concurrent guests, and a
creation-latency distribution. They do not establish end-to-end chat latency or a p95.

The original native publisher released attempt 3 after qualification at attempt 2. The original web publisher
released attempt 2 after qualification at attempt 1. All four immutable digests remained unchanged, and the retained
native index artifacts matched exactly. The bounded publication window closed afterward.

Kargo Freight `61b6337bd9eee9547f0d94a251be0f53ff840b02` completed Ofz, Tengri, and Proompteng promotion in that order.
Ofz migration and rollout verified before either consumer promoted. All three Applications were synced and healthy:

| Application | Generated GitOps revision                  |
| ----------- | ------------------------------------------ |
| Ofz         | `cabba6ae99378cccbd2e9a7135417183d45e9595` |
| Tengri      | `9af97786541e0a11c5eb277548828850cb4fb69b` |
| Proompteng  | `1f7413db6ab876913614a03a5a25687d4bbbc1ab` |

[PR #15261](https://github.com/proompteng/lab/pull/15261) supplies the workers' SPIRE registration. Its application
and proxy selectors retain the existing namespace, service account, container, and identity constraints. Registration
counts were checked against the actual selected Pod UIDs, including retained worker versions. Unregistered-workload
denial passed in the earlier rollout.

Restate registered `TengriAgentRun`, `TengriRunControl`, and `TengriWorkspaceRuns` against deployment
`dp_11hbpmw7qcn7tckcaKuH1E5`, matching the new RestateDeployment generation and exact running worker images.
Run and control journals retain seven days; the workspace object retains one day. Registration and readiness do not
prove authenticated product behavior.

## Retained-home API 7 replacement

The [claimed-guest replacement procedure](operations.md#replacing-a-claimed-guest-while-retaining-its-home) replaced
only the stopped API 6 slot. The current home contains the fresh native login, conversations, and earlier acceptance
evidence. It was retained through the API 7 replacement.

Authenticated sleep committed before controller quiescence. The exact old Pod was deleted with UID and
resourceVersion preconditions and normal termination grace; volume detachment was verified. The home and allocation
remained intact while the qualified image was enrolled and the original publishers released. The generated Tengri
commit was rendered and checked before removing only the temporary reconciliation pause. Argo restored the reviewed
controller replicas. The controller then prepared the new slot and recorded its actual Pod UID.

| Identity         | Retained or replacement value          |
| ---------------- | -------------------------------------- |
| MicroVM UID      | `a8cd3a6e-9e60-4ed3-98e3-a080d35a457f` |
| Lease UID        | `9bdc053c-cd84-42c6-8403-7ef8e37fb56a` |
| Home PVC UID     | `bb8ec4a4-fbfe-453e-b70a-a3f44d23d464` |
| Filesystem UUID  | `8d55d060-5ed0-4d13-ab0c-978b15b982e1` |
| New slot Pod UID | `ccbe9cc1-658a-43de-9c50-ac0d82951683` |

After preparation, the VMM was absent and no runtime was authorized. Read-only disk inspection verified the same
32 GiB capacity, filesystem UUID, all five representative public-file hashes, and the same native conversation-store
inode. No authentication file or stored private operation payload was read. Authenticated resume and conversation
readback remain acceptance gates. An older memory snapshot cannot be restored against the advanced current home.

## Authenticated acceptance

The following runs used the earlier source `1c0b856fa820407c29a6869476ff0af4f2b5f32d`.

Normal owner sign-in through the existing saved 1Password passkey passed without new enrollment or manual unlock.
The fresh workspace also completed normal Codex sign-in. Run `7d4d6f0a-e574-4df2-adb9-5c7153fc2856` returned
`TENGRI_RECOVERY_OK` through the desktop.

Run `de18e396-2a5a-49b5-9dbf-21cc27fe9809` survived browser reload and one exact worker Pod replacement. Its
original foreground process completed with one unconditional, fsynced append. The accepted Restate invocation
retried under the same pinned deployment and native turn. This establishes running-command recovery across a worker
replacement, without an application deduplication guard hiding duplicate dispatch.

Run `05321bc8-32bd-4f19-aca5-34e88a66e77d` exposed a cancellation defect. Native interruption ended the turn but left
its yielded command running. [PR #15278](https://github.com/proompteng/lab/pull/15278), merged as
`8e9d418f44e0e61b61de0bf412d1b80a32c4f471`, adds command cleanup and the API 7 receipt contract. Its pinned native
regression passes. The API 7 image and retained-home replacement are deployed. The final live Stop check is pending
normal owner sign-in.

The following acceptance sequence applies to the new release. Completed checks above remain evidence for the earlier
cohort; they do not establish the final cohort's product behavior:

1. Sign in with the saved passkey and resume the retained workspace through authenticated lifecycle control. Verify
   that the existing native Codex login and conversation survive the replacement.
2. Submit one bounded foreground append-and-fsync command with a unique nonce and recorded PID/start ticks. Record
   its run ID, native thread/turn IDs, generation, and dispatch receipt. Do not add an application deduplication guard.
3. Reload during execution and replace one exact worker Pod with UID/resourceVersion preconditions and normal grace.
   Retain its RestateDeployment, pinned version, and image. Observe the same invocation retry or replay, the same
   running guest process, and one append.
4. Stop that exact command before its bounded wait expires. Require the durable Stop result, a version 2 native
   terminal receipt with `processesStopped: true`, the process absent, one append, and release of the active-run pin.
   Uncertainty remains pending cancellation or reconciliation.
5. Reload an actual pending native approval. Approve its exact ID, generation, operation, and scope once through the
   desktop. Verify its durable control receipt and one effect. Stale-generation rejection also retains its real native
   fixture proof; do not forge production authorization to manufacture a negative case.
6. With all runs terminal, terminate only the identified native Codex app-server process. Verify a new process, the
   replayed Ready state, and a usable reply without a stale restart banner.
7. Verify authenticated sleep/resume, retained file and conversation identities, and terminal pin release. Retain the
   existing automatic-sleep policy. The real wall-clock idle expiry remains distinct from the tested CAS boundary.

The local append-only decision trail is `.audit/tengri-durable-execution.tsv`. Native run artifacts retain qualification
attempts and image indexes. These artifacts, release readback, and the remaining product receipts have distinct scopes.

## Dispatch latency and activity messages

At 19:25 UTC, run `948e959b-8873-4c32-9cec-320a85b40090` took 14.405 seconds from durable acceptance to native
dispatch. Its initial workspace claim took 4.335 seconds and the separate initial Stop lookup took 3.833 seconds.
Tempo recorded a 20.535-second send request. Failed status reads exhausted their two-second Restate deadline after
authorization, returning HTTP 503 while the native turn continued.

The repair returns the initial Stop from the workspace claim and removes the redundant call. It retains the final
Stop check after preparation and before dispatch. Status handlers retain journaled signature and expiry verification.
An isolated pinned-engine worker-kill probe reproduced a journal mismatch when query expiry was rechecked before
replaying the state read, so that attempted optimization was rejected. The private claim response changes require
active run and control invocations to drain before worker registration. Old pinned versions remain available for
retained history.

The desktop uses concise activity labels and retries transient status failures with a reconnect message. A successful
read clears that failure. The focused browser regressions and real Restate crash/rotation/expiry fixture pass locally.
The repair is deployed; post-deployment latency remains unmeasured. The observed mean durable append was 328
milliseconds, so removing serial calls does not resolve the separate shared-storage bottleneck. No durability or
authorization setting was weakened.

## Settings passkey enrollment

Desktop authentication has an eight-hour absolute limit and a 30-minute idle limit. Only permitted control activity
renews the idle deadline; background status polling and stream rechecks do not. A maintenance window longer than the
idle limit can therefore require normal sign-in again. Reuse the saved passkey, then explicitly resume the retained
workspace when it is prepared. This expiry does not require another passkey enrollment or a home reset.

[PR #15215](https://github.com/proompteng/lab/pull/15215) is included in the deployed cohort. Its entry point is
**Settings → Access → Add another passkey**. The Keycloak theme is deployed. The virtual Keycloak/browser/Ofz fixture passed
165 assertions. The owner saved the additional passkey in 1Password. Subsequent same-identity sign-in through that
saved passkey passed against the deployed product. Keep the original credentials, GitHub subject, broker links, RP ID,
and WebAuthn verification policy. No further enrollment is needed. The merged sign-in cleanup in
[PR #15269](https://github.com/proompteng/lab/pull/15269) is included in the deployed API 7 cohort.

Verification leaves credential selection to the browser or password manager. The page omits the noninteractive
inventory of opaque credential labels and transport names. While verification is pending, its disabled button says
"Check your passkey dialog". The hidden credential allow-list and one-click request protection remain intact.
The real Keycloak fixture rejects the old inventory, verifies the pending state and reload recovery with two saved
credentials, and retains its exact-challenge failover, identity, enrollment, and mobile accessibility checks.

## Observed limits

SPIRE's full HA verifier failed because its three existing server Pods share one node. Workload issuance and denial
for an unregistered workload passed. The worker registration fix does not establish survival of that node failing.
The native resume timing variation also lacks a proven root cause. Neither limitation is hidden by successful release
or readiness checks.

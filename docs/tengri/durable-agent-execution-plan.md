# Tengri durable agent execution

Status: Deployed through Kargo and Argo on 2026-10-22. Authenticated product acceptance is pending owner sign-in.
Goal `01a15d3d-a9f2-7320-a38a-473615e3425c` remains active.

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

Arbitrary shell or browser effects require authoritative readback or an explicit uncertain outcome. A workflow wrapper
cannot make every external action transactional. Automatic replay must stop when the outcome cannot be proved.

## Qualification and version retention

The disposable Restate fixture uses the pinned server and SDK, two registered worker versions, and actual worker
`SIGKILL`/restart. It covers duplicate and changed controls, workspace exclusion, newer Stop authority, queued signed
requests across HMAC rotation, and recovery under the same operation UUID. Its guest is sleeping. This proves
orchestration recovery, not recovery of an executing production shell command.

The final source passed the [desktop browser workflow](https://github.com/proompteng/lab/actions/runs/39748241073),
including the real Chromium/CUA/VS Code gates. Component fixtures cover Codex acceptance, runtime SQL contracts,
Rust/Go authorization transport, BFF identity replacement, and the automatic-sleep CAS boundary.

Restate retains versions with pinned invocations. The rollback history limit does not cap live draining versions.
The namespace allows six slots, three controller Pods including surge, and eight worker Pods. Limits including
sidecars are 42 CPU / 63 GiB; requests remain within 27 CPU / 57 GiB. Controller pools reserve at most 30 SQL
connections during surge, and eight workers use eight more, below the existing controller-role limit of 42.
Additional versions wait for a verified drain. Pinned workers and acceptance evidence cannot be force-deleted.

## Deployed cohort

The release observation at 2026-10-22 09:52 UTC matched the deployed image cohort to source
`1c0b856fa820407c29a6869476ff0af4f2b5f32d` and schema
`a0e81e7a9e92a191cbe80b79ddda7019ae2aaac7a90173f83515a2e82256bb9f`.

| Image            | Immutable index digest                                                    | Publication                                                                     |
| ---------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `lab/tengri`     | `sha256:d75c7099310e2d5c866237d2e658c7c4677d4b2149e3d7b523004a83e2d12a6c` | [Tengri images](https://github.com/proompteng/lab/actions/runs/39748240939)     |
| `lab/nanoagent`  | `sha256:56147d078c6191a3f7569f4b26491f7a14af4e44bd481dcdd89c3d550c15d4cd` | Same paired native run                                                          |
| `lab/ofz`        | `sha256:22575f090ecb1ba5eaf1b258c81caf6fe73709b97a5237c11fe6ae7a25feba08` | [Ofz authorization](https://github.com/proompteng/lab/actions/runs/39748241145) |
| `lab/proompteng` | `sha256:b5fda00b6d6e6c07a2fced48f6bd3da2a00dee7f965145c6d2de4626914bd620` | [Product images](https://github.com/proompteng/lab/actions/runs/39748241071)    |

Both native architectures passed the unchanged qualification gates. The first AMD64 cold-resume attempt failed;
the single unchanged diagnostic rerun passed on the same Ryzen host. Earlier latency failures remain unexplained.
The original successful publishers exposed the release aliases after enrollment, with all four digests unchanged.
No native image was rebuilt or substituted after enrollment.

Kargo Freight `16cfbf47c62322d9c97bb3cc2c56dfdab18bb08d` completed Ofz, Tengri, and Proompteng promotion in that order.
Ofz's checksum-bound migration hooks succeeded before either consumer promoted. All three Applications were synced
and healthy at these generated revisions:

| Application | Generated GitOps revision                  |
| ----------- | ------------------------------------------ |
| Ofz         | `ad5dfdb7963e8520653ada37d1fd6455adff4157` |
| Tengri      | `ea54af9713c6bd583feea200ce74bcd62f935f6b` |
| Proompteng  | `072edb6d12e27abf379f48ff89696a7d055d13a7` |

The rollout exposed missing SPIRE registration for the workers. [PR #15261](https://github.com/proompteng/lab/pull/15261)
merged as `1c8eee65e64e888b5717bf049e0c25626940f5d3` and reconciled through the SPIRE Application. Both application
and proxy registrations now select the two controllers and two workers with the existing identity, namespace,
service-account, and container constraints. Unregistered-workload denial passed.

Restate registered `TengriAgentRun`, `TengriRunControl`, and `TengriWorkspaceRuns` against deployment
`dp_10DtdK0Baf0sbepKZAUs32p`. Both worker replicas are ready. Registration and readiness do not prove authenticated
run recovery.

## Completed clean cutover

The owner explicitly waived preservation of the old workspace files, conversations, credentials, and guest state.
That instruction superseded the earlier retained-home preservation plan. Platform sign-in identity, Ofz authority,
and allocation identifiers remain intact.

The cutover completed these steps:

1. Stop the old guest through authenticated sleep and verify its writer is fenced.
2. Pause only Tengri reconciliation and quiesce the old controllers, preserving automatic sync policy and Kargo metadata.
3. Reset the approved home to an empty ext4 filesystem and verify its new UUID before preparation.
4. Delete the exact stopped old slot Pod with UID/resourceVersion preconditions. Retain the Ofz-bound allocation identifiers.
5. Enroll the qualified guest digest, then release only the original successful publishers.
6. Verify the generated Tengri revision before removing the temporary reconciliation pause.
7. After the new controllers start, clear the old Lease Pod UID and then the MicroVM slot binding.
8. Verify the actual successor Pod UID, qualified images, new filesystem, and prepared snapshot. The guest is sleeping
   with no authorized runtime started and no Firecracker process resident.

No old files or memory snapshot were imported. The existing release hold is now open. Normal recovery still preserves
current run identities, journals, homes, and authority fences. An older memory snapshot cannot be restored against
an advanced disk. The [claimed-guest replacement procedure](operations.md#replacing-a-claimed-guest-while-retaining-its-home)
remains the normal maintenance procedure when preservation is required.

## Remaining authenticated acceptance

The existing owner session expired. The browser is waiting for its existing passkey response. The following checks
remain unverified against the deployed product:

1. Complete normal owner sign-in and resume the fresh workspace through authenticated lifecycle control. Complete
   normal same-account Codex sign-in if the clean home requires it.
2. Submit a new bounded run through the desktop. Record its run ID, native thread/turn IDs, generation, and dispatch receipt.
3. Run an unconditional append-and-fsync command with a unique nonce, a recorded PID, and a bounded foreground wait.
   Do not use an application idempotency guard that could hide duplicate dispatch.
4. Reload the browser during execution and recover the same run and native turn.
5. Replace one exact worker Pod with UID/resourceVersion preconditions and normal termination grace. Retain its
   RestateDeployment, pinned version, and immutable image. Observe the accepted invocation's retry or replay across
   replacement. Require the same guest process to finish, one append, and an authoritative terminal receipt for that turn.
6. Reload an actual pending native approval. Approve its exact ID, generation, operation, and scope once through the
   desktop. Verify its durable control receipt and reject a stale generation without applying an action.
7. Stop another bounded foreground command after worker replacement. Verify the durable Stop receipt, exact native
   terminal cancellation, and the recorded process outcome. Uncertainty remains pending cancellation or reconciliation.
8. Verify the exact active-run sleep pin, terminal pin release, and authenticated sleep/resume. Retain the existing
   automatic-sleep policy and fresh Ofz decisions throughout.

The local append-only decision trail is `.audit/tengri-durable-execution.tsv`. Native run artifacts retain qualification
attempts and image indexes. These artifacts, release readback, and the remaining product receipts have distinct scopes.

## Settings passkey enrollment

[PR #15215](https://github.com/proompteng/lab/pull/15215) is included in the deployed cohort. Its entry point is
**Settings → Access → Add passkey**. The Keycloak theme is deployed. The virtual Keycloak/browser/Ofz fixture passed
165 assertions; it does not prove physical 1Password enrollment or sign-in.

After normal sign-in, open the deployed enrollment flow and retain the original USB credential, GitHub subject,
broker links, RP ID, and WebAuthn verification policy. The owner completes new credential creation and saving in
1Password. Real provider enrollment and subsequent same-identity sign-in remain unverified.

## Observed limits

SPIRE's full HA verifier failed because its three existing server Pods share one node. Workload issuance and denial
for an unregistered workload passed. The worker registration fix does not establish survival of that node failing.
The native cold-resume failures also lack a proven root cause. Neither limitation is hidden by successful release
or readiness checks.

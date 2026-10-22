# Tengri durable agent execution

Status: Main migration merged; image qualification and retained-home cutover pending. Goal `01a15d3d-a9f2-7320-a38a-473615e3425c`.

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

| Unit | Contract and implementation                                                                                                                                                                                                                                      | Required evidence                                                                                                     | State            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------- |
| 1    | Reproduce lost-response submission and establish the pinned Codex correlation contract. Require stable operation IDs through browser, BFF, controller, and guest. Persist dispatch before writing to Codex and reconcile uncertain acceptance without resending. | Concurrent duplicate, changed payload, lost response, process replacement, and native pinned-Codex correlation tests. | Locally verified |
| 2    | Add the durable run domain and Restate Rust worker outside the guest. Serialize workspace mutation and persist accepted inputs and terminal outcomes in Restate, with signed Tengri admission.                                                                   | Disposable Restate 1.7.9 with pinned SDK, worker crash/replay, workspace exclusion, and changed-payload rejection.    | Locally verified |
| 3    | Route approvals, steering, and cancellation through identified durable controls. Retain exact generation and scope. Obtain fresh Ofz decisions for effects.                                                                                                      | Duplicate and stale control, restart, policy denial, and verified cancellation tests.                                 | Locally verified |
| 4    | Recover run state in the desktop. Retain submission identity across retries and reloads. Keep active work awake without overriding explicit sleep, removal, or revocation.                                                                                       | Browser reload/retry and controller idle-boundary regression tests.                                                   | Locally verified |
| 5    | Remove displaced direct dispatch and retry paths. Configure immutable worker registration, paired release, network isolation, and bounded retention through existing GitOps.                                                                                     | Consumer search, rendered manifests, component checks, and replay across a worker version change.                     | Locally verified |
| 6    | Review, commit, push, required CI, automatic review fixes, merge, image publication, Kargo, Argo, and authenticated acceptance.                                                                                                                                  | Exact commit, image, promotion, workload, and real product receipts.                                                  | In progress      |

## Design constraints

The core identities are run ID, operation ID, workspace UID, runtime epoch, thread ID, turn ID, and approval ID. Run
states distinguish accepted, running, waiting, recovering, needs reconciliation, and terminal outcomes. A transport
failure cannot create a fresh operation identity or imply that execution stopped.

Two shapes were considered. Putting the run loop inside elected reconciliation would tie work to controller leadership
and couple retries to lifecycle control. A separate versioned worker in the existing Rust codebase keeps durable run
execution independent of that elected future. Restate owns orchestration. Ofz and shared SQL retain authority and
fencing. Nanoagent owns the exact Codex process interaction.

The first unit can be validated independently, before introducing the execution engine. Its journal records uncertain
dispatch rather than pretending that a local record and an external Codex request can commit atomically. Existing
accepted work must drain or reach explicit reconciliation before deleting a worker version or execution contract.

## Evidence and recovery

The local append-only decision trail is `.audit/tengri-durable-execution.tsv`. Each unit updates this plan with actual
checks and delivery receipts. Fault injection uses disposable fixtures only. Production mutations use reviewed GitOps
and the existing release path. Recovery preserves the retained home, run identities, journals, and authority fences.

Native shell or browser effects cannot acquire transactional semantics through a workflow wrapper. The implementation
must reconcile their observable state or stop with an explicit unknown outcome. It must not weaken this boundary to
make a recovery fixture pass.

## Local evidence

- Pinned Codex 0.159.2 confirms persisted `userMessage.clientId` and metadata-only turn pages. The native contract
  test recovers the same accepted turn after removing its committed response receipt and observes an exact terminal
  outcome after interruption. It uses an isolated, unauthenticated loopback fixture provider.
- Nanoagent race coverage includes concurrent duplicate submissions, changed payload, lost response, read-only
  acceptance reconciliation, supervisor replacement, stale approval generations, and committed approval retries.
- A disposable Restate 1.7.9 accepted and recovered the same workflow after an actual worker `SIGKILL`, rejected
  changed input and a cross-owner query, excluded another workspace run, and accepted Stop after replacement.
  Its guest is sleeping. This proves orchestration recovery, not recovery of an executing shell command.
- The controller test suite passed 205 tests with 45 environment-dependent tests ignored; the CRD suite passed
  three tests and the cross-language authorization suite passed 11. All 419 landing tests passed, including 77 BFF transport, input schema, and operation
  identity tests. TypeScript checking and Oxlint passed. The complete desktop browser suite passed 167 tests with two environment-specific skips.
- Kustomize rendering confirms the controller and Restate worker use the same immutable Tengri digest and the
  worker references the generated paired Nanoagent release ConfigMap.
- Nix's daemon is unavailable locally. Checks use the pinned Go 1.25.5, Rust 1.90.0, and Bun 1.4.2 directly.

The 37 shared-SQL runtime contracts passed across the full and focused fixture runs. Real Rust/Go transport and
BFF mTLS/SVID replacement fixtures passed. The idle CAS regression passed. Two independently registered worker
versions, actual process replacement, and duplicate/changed control receipts passed against Restate 1.7.9. Snapshot sleep retains its running
processes, so it is recorded as pending cancellation and never treated as terminal cancellation. Permanent
workspace removal requires the final Ofz receipt and closes abandoned workflows. Kubernetes absence is insufficient.

Required CI, merge, image-publication, Kargo promotion, Argo rollout, and authenticated live acceptance remain
open delivery gates. The live boundary remains required. Existing guest API 5 snapshots require fenced retained-home
migration to API 6; admission must remain closed until the complete image and BFF contract is present. Inventory and
preserve MicroVM, PVC, slot, filesystem identity, retained files, credentials, and native conversations before cutover.
Follow the existing retained-home enrollment and runtime-fencing procedures; never reformat or delete retained homes.

## Version retention and recovery

The implementation uses one Restate workflow per run, one per identified control, and one keyed workspace claim.
A control records its exact approval scope before its native effect and exposes the original result on retry.
Read-only query journals expire immediately; unchanged observations do not repeat full state in the run journal. An independent SQL run table
and outbox were rejected because they would add a second owner of accepted input and recovery state. Signed admission
protects worker ingress; fresh Ofz decisions and shared SQL authority protect every effect.

The Restate operator retains versions with pinned invocations. Its rollback history limit does not cap live draining
versions. The fixed namespace and SQL budgets allow eight worker Pods alongside controller surge and six slots.
Additional versions must wait for a verified drain; do not purge acceptance evidence or force-delete workers.
The operator's [versioning contract](https://github.com/restatedev/restate-operator) governs this boundary.

## API 6 cutover

The existing release hold `TENGRI_PREPARED_SLOT_CUTOVER_READY` was set to `false` before publication. Production
currently has one retained API 5 workspace in `Sleeping`. Do not release either application alias until its original
writer is fenced and its unchanged 32 GiB home is enrolled with the reviewed API 6 guest digest. Preserve its MicroVM
UID, home PVC UID, filesystem UUID, representative file hashes, credentials, and native conversations. Record the paired
image receipts, Kargo branches, and Argo revisions here as delivery progresses. No new identity or device permissions
are part of this migration.

## Review delivery

[PR #15241](https://github.com/proompteng/lab/pull/15241) carries the hard migration. Initial CI exposed missing
authorization inventory entries and the changed kube-router policy fingerprint. The complete inventories and policy
set now pass 25 Ofz inventory tests and 54 kube-router tests locally. Linux browser setup hit a vendor CDN certificate
hostname failure before testing; the installer uses the exact Playwright-planned Chrome and headless-shell versions
from the official Chrome for Testing storage endpoint with normal HTTPS verification. Required CI and live acceptance
remain open.

The maximum namespace overlap is six slots, three controller Pods including surge, and eight worker Pods. Limits
include sidecars: slots consume 25.5 CPU / 54.75 GiB, controllers 4.5 CPU / 2.25 GiB, and workers 12 CPU / 6 GiB.
The quota is therefore 42 CPU / 63 GiB; requests remain within 27 CPU / 57 GiB. Controller pools reserve at most
30 SQL connections during surge, and eight workers use eight more, below the existing controller-role limit of 42.

Review recovery regressions now cover locally synthesized process failure, typed native rejection, and durable native
terminal receipts bound to the accepting generation. A failed or interrupted history entry reconstructed by a new
process remains uncertain unless that receipt exists. The pinned Codex fixture verifies native missing-thread rejection,
held-request interruption, and the terminal notification receipt. Ambiguous browser retries keep their original model
settings and operation UUID, with an explicit notice if the selection changed. The first Linux desktop workflow,
including real Chromium/CUA/VS Code acceptance, passed at `e831184c33`; the final source must pass the same gate.

Cancellation retains the latest authenticated Stop in the existing workspace object. A new login can supply fresh authority
after a long explicit sleep; an older delayed Stop cannot replace that context. Only the run workflow interrupts and
observes the exact turn. The real Restate fixture verifies two distinct session contexts, stale delivery ordering and
retention of the newer context across worker SIGKILL/restart. Slow read-only reconciliation continues periodically
without resubmitting an uncertain native request.

Keep each publication attempt's KVM diagnostics and verified image index artifacts. Their names include the run attempt,
so re-running held publication does not collide with an immutable artifact or replace earlier acceptance evidence.
After enrolling the reviewed guest digest, rerun the original main run's publisher against its unchanged architecture
artifacts, require successful original build/validation gates and fresh signing, and verify both digests remain exact.
Never rebuild and silently substitute another guest digest after enrolling the home.

Accepted runs acquire their sleep fence before guest availability is required. Preparation and native dispatch use
separate durable steps: a replay after possible native acceptance cannot reinterpret a changed image or expired
authority as proof that no effect occurred. The replay retains an uncertain outcome and reconciles the original
operation identity. A confirmed Stop acknowledgement clears its browser retry identity so another login can record
fresh cancellation authority; ambiguous failures retain the identity. Both regressions pass, alongside the full
205-test Rust suite and the real Restate worker SIGKILL fixture.

The final review also requires a durable Stop check between preparation and native dispatch. The real Restate fixture
records Stop at that boundary and exercises the production dispatch gate. Workspace claims retain the exact
authenticated run binding in the workspace object. Stop reads and release compare the stored
claim after HMAC rotation; a changed claim remains denied. The fixture rotates the mounted key and replaces the
worker before checking retained Stop authority and releasing the original claim.

Signed run and control attempts enter through retryable shared handlers on the existing workspace object. Signature
verification completes before creating either private workflow. A queued attempt that encounters key rotation fails
without consuming its run or control UUID; a freshly signed retry can recover the same logical operation. Accepted
workflow and claim calls do not revalidate an old envelope against a newly projected key. The real fixture queues old
signed attempts with both worker versions stopped, rotates their mounted key, restarts the workers, and verifies
freshly signed retries under the original operation UUIDs.

## Delivery receipts and remaining gates

PR #15241 merged as `7fc2916a11d882b22225bc20006a093d52aafc64`. Required PR checks and the Linux
Chromium/CUA/VS Code workflow passed, including the same browser workflow on that merged source. The main
[native image run](https://github.com/proompteng/lab/actions/runs/39709766558) failed its AMD64 KVM gate:
the first resume took 3,119.74 ms against the unchanged 1,000 ms limit; the next two took 510.31 and 496.39 ms.
ARM64 passed. Both platforms' diagnostics are retained as run artifacts. Paired publication was withheld. The
latency cause remains unproven; a later successful run cannot establish that this failure was fixed.

Browser regression coverage also reproduced approval and question retries reusing a terminally rejected control ID,
and auto-approval dispatch before an accepted run had a native turn. Retire the browser identity only for the exact
`control_not_dispatched` response, retain it after ambiguous failures, and wait for a running, approval-waiting, or
recovering run before auto-approval. The three defect cases failed before the change; all five focused cases pass
after it. The complete local browser suite passes 172 tests with two environment skips; all 419 unit tests,
TypeScript checking, formatting, and lint pass.

The release hold remains closed. Qualify a complete four-image cohort from the final reviewed source against the
unchanged native gates before enrolling the retained home. Owner passkey sign-in is still pending, so authenticated
legacy-work reconciliation and product acceptance remain unverified. Complete safe quiescence and fencing, enroll
the exact qualified API 6 guest digest without replacing the home, release through Kargo and Argo, and exercise
disconnect/recovery, approval, cancellation, worker replacement, and the active-run sleep fence before closing the goal.

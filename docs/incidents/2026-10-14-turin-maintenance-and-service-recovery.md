# Turin maintenance and service recovery on October 14, 2026

Status: recovery in progress. Evidence updated through approximately `11:27Z` on October 14.
This report does not declare the incident closed or all applications recovered.

## What happened

An authorized Kata r6 installation on physical Turin became a prolonged infrastructure outage.
The maintenance drained a host that also carries three Ceph OSDs, one Ceph monitor, trading dependencies,
GPU workloads, and CI capacity. The installer completed, but the first reboot lost the Kingston NVMe
used by the three OSDs for BlueStore DB and WAL. A chassis power cycle restored disk enumeration.
The subsequent boot stalled mounting the ORICO XFS `EPHEMERAL` filesystem during quota checking.

A third restart completed the quota check and returned Turin to Kubernetes. The host recovered with
project quotas still enabled. The staged attempt to disable quotas did not become the active configuration
and must not be credited with the recovery.

Restoring host readiness did not restore all applications. Two Mimir volumes reported ext4 metadata errors.
The private registry had RBD mount timeouts. Kafka had unavailable partitions despite several ready Pods.
Bayn had an unfinished GitOps deployment with old containers still requiring a removed secret key.

## Impact and evidence boundaries

- Turin was drained and remained cordoned until host, disk, storage, GPU validation, and four Kata runtime checks passed.
- Turin's interruption removed three of six Ceph OSDs and one of three monitors. Altra also rebooted while Turin
  was unavailable. Both storage hosts were therefore interrupted during the incident; describing the whole outage
  as uninterrupted operation on the other three OSDs is incorrect. The exact interval of complete storage or etcd
  unavailability has not been established.
- The registry outage blocked missing image pulls and image publication for unrelated applications.
- Bayn's database replica, two ledger replicas, GPU model, and one Valkey replica could not schedule during the cordon.
- Bayn's old application replicas were already unavailable at `07:10:12Z`, before the maintenance drain.
  That existing deployment failure must be distinguished from the additional infrastructure interruption.
- Altra's kernel boot timestamp was `07:49:43Z`, while Turin was still unavailable. The cause and owner of that
  overlapping reboot have not been established. Its timing is confirmed; causation is an open investigation.
- No conclusion about missing trades, accounting loss, data loss, or trading readiness follows from Pod readiness alone.

## Timeline

All timestamps below are UTC on October 14. Pacific daylight time is seven hours earlier.

| Time           | Confirmed event                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| 07:10:12       | Bayn Deployment recorded no minimum availability, before the physical maintenance.                                  |
| About 07:30    | Turin was cordoned and drained for the authorized installer replacement.                                            |
| 07:37:36       | First physical restart requested after successful r6 installation.                                                  |
| 07:41:48       | New Turin boot observed. Kingston NVMe was absent.                                                                  |
| 07:49:43       | Altra kernel boot timestamp during the Turin outage. Cause remains unresolved.                                      |
| 07:53:55       | Turin chassis power cycle requested after disk rescan failed.                                                       |
| 07:57:25       | New Turin boot observed with all four expected NVMe serials present.                                                |
| 08:04 to 08:23 | Repeated observations showed the XFS quota flush blocked with unchanged disk counters.                              |
| About 08:28    | Talos accepted a staged quota-disable configuration. Persistent resource readback showed `false`.                   |
| 08:30:42       | Third restart requested to apply that staged recovery.                                                              |
| 08:34:09       | New boot started the quota check with quotas still enabled.                                                         |
| 08:34:59       | Kernel logged `Quotacheck: Done.` and Talos mounted `/var`.                                                         |
| 08:35:18       | Turin became Ready. CRI, etcd, kubelet, and Tailscale were running.                                                 |
| About 08:38    | Four existing Turin-pinned Ceph Pod instances received a temporary cordon toleration.                               |
| About 08:40    | All four Kata runtime checks passed with guest and host evidence.                                                   |
| About 08:41    | Six original OSDs were up and in, all three monitors had quorum, and all 601 PGs were active. Turin was uncordoned. |
| About 08:44    | Registry RBD snapshot retained before offline filesystem recovery.                                                  |
| 09:09:31       | Turin's committed `EPHEMERAL` growth prevention merged; later active and persistent readback confirmed it.          |
| 09:36:10       | Hermes foreground-process PID-file fix merged.                                                                      |
| 09:52:02       | External Secrets controller memory fix merged.                                                                      |
| 09:53:26       | Existing External Secrets canary refreshed after the normal controller rollout.                                     |
| About 09:56    | Both repaired Mimir claims passed clean checks; original ingester owner and Argo reconciliation restored.           |
| 09:56:12       | Kafka broker 3 finished its natural restart and logged `Kafka Server started`.                                      |
| About 10:09    | All three Mimir ingesters and all three Tempo V3 live stores were Ready.                                            |
| About 10:22    | Registry cleanup was suspended before its scheduled run while the registry volume remained offline.                 |
| About 10:27    | Full registry read-only filesystem check completed with exit 0 after repair.                                        |
| 10:34:26       | Restored registry front door returned HTTP 200 from `/v2/`.                                                         |
| About 10:40    | The current Bayn source image finished normal immutable publication after registry recovery.                        |
| About 10:54    | Hermes toolchain Kargo promotion reported `Succeeded`.                                                              |
| About 10:56    | Registry cleanup and Argo reconciliation restored after the missed cleanup deadline had expired.                    |
| 11:08:48       | Bayn committed migrations 97, 98, and 99 in the native PostgreSQL migration table.                                  |
| 11:17:00       | Sealed Secrets web architecture placement fix merged.                                                               |
| By 11:18       | Torghut Kargo promotion succeeded; both Flink jobs reported `RUNNING`; Sealed Secrets web had one Ready replica.    |
| By 11:27       | Both Flink jobs had fresh completed checkpoints; Bayn controllers reported fresh crypto projections with zero lag.  |

## Confirmed failure mechanisms

### Missing Ceph metadata device

The Kingston serial `50026B76878F0B27` disappeared after the first reboot and returned after a chassis power cycle.
The original OSD identities and data disks were preserved. This proves enumeration recovery, not the cause of the
hardware failure. No OSD was purged, reformatted, or recreated.

### XFS quota flush blocked host startup

A blocked PID 1 thread waited in `xfs_qm_flush_one`, reached through `xfs_qm_quotacheck` and `xfs_mountfs`.
Disk counters stopped changing. `/var` was not mounted even though the volume status said `ready`.
CRI waited for the mount. The Tailscale extension waited for CRI, so the node also could not reach Omni's
Tailscale endpoint. The console's unreachable SideroLink endpoints were downstream symptoms of incomplete boot.

The existing [quota investigation](../../devices/turin/docs/xfs-quota-boot-recovery.md) had documented this failure
class on October 10. Talos's temporary growth mount disables quota accounting and forces a recount on the final mount.
The underlying kernel flush-lock trigger on this host remains unproven.

### Application recovery required more than node readiness

Ceph block availability returned before every filesystem could mount. CSI explicitly required manual ext4 repair
for Mimir ingesters 0 and 1. Their claims are `pvc-4a2a8f0e-5860-4bfe-8a29-78a2557f75eb` and
`pvc-5ec81c52-7be4-44df-98f4-d451e90d6a1b`. The registry claim is
`pvc-7cefa093-bbfd-448c-9b9e-6228bf672374`; its recorded failures were mount timeouts and an operation already in progress.
Repair acceptance requires an RBD snapshot, a stopped owner, no attachments or users, and an unmounted filesystem.

The recovery agent initially attributed nearby CSI filesystem errors to the registry without resolving the
request's volume handle to its PVC. That was incorrect. It led to an offline forced check of the 2 TiB registry
filesystem, extending registry downtime. The registry's own metadata errors were not established by those logs.
The forced check later independently found an invalid upload-directory inode and corrupted directory entries.
That later discovery does not justify the earlier incorrect diagnosis. The check corrected those entries and
restarted its scan. Its one-hour maintenance Pod deadline was insufficient for the restarted scan; the agent sent
SIGINT, waited for exit 32 and the original process to disappear, and continued the offline check from a separate
three-hour Pod. The original volume remained unmounted throughout. The subsequent check uses a bounded 4 MiB
readahead window after the original process was observed blocked in kernel `fadvise` readahead.

The final registry repair exited 1, indicating corrected errors. A separate full read-only forced check then
exited 0. Native feature readback also showed that this filesystem had no ext4 journal. With the owner stopped,
the snapshot retained, and no mount or other device user, `tune2fs -j` added a standard journal. Feature readback
then contained `has_journal`, journal inode 8, and a clean filesystem state; a subsequent non-forced read-only
check also exited 0. The original StorageClass did not disable journaling. Why this particular filesystem lacked
a journal has not been established. The journal reduces one recovery risk; it is not proof against future corruption.

The original registry Deployment and claim were restored. HTTP 200 from `/v2/`, a retained Bayn manifest with its
expected digest, successful immutable image publications, and fresh private image pulls established current service
recovery. They do not prove that every historical registry blob remains valid. Repair cleared an invalid blob link
for `sha256:fcedcb5c61d35b66579470e6b235de3b2613d4dc0523483a7bd727d0587a6add` that pointed at an upload directory.
A complete retained-catalog audit remains open. No tag alias was fabricated or used to conceal a missing artifact.

All registry maintenance Pods and owned offline mappings were removed. The registry's production CSI mount later
reused the same `/dev/rbd12` name; that device number no longer identified a maintenance mapping. The scheduled
cleanup was suspended during repair and restored after its 30-minute starting deadline expired, preventing a delayed
cleanup run from competing with recovery uploads. Argo's original reconciliation policy was restored as well.

Kafka's metadata quorum was available, but the unavailable-partition query still reported partitions without leaders.
Broker 3 had failed initial registration at `08:11:59Z` while the controllers were unavailable, then waited for
log recovery and a graceful log shutdown. A thread dump showed its main thread waiting for log-closing workers
performing filesystem flushes. It exited at `09:51:23Z`, restarted through its existing Pod policy, and reached
`Kafka Server started` at `09:56:12Z`. No data-broker Pod was manually deleted to force that transition.
The unavailable-partition query returned zero after that restart, but replication and fresh ingestion still
required separate acceptance.

Bayn's activation hook was retried from the existing Kargo-generated commit after its dependencies returned.
After Kafka recovery, the controller still failed migration 97 because the old image converted retained orders
before replacing a schema-version-dependent constraint. The Bayn owner had already merged the source repair in
[PR #15033](https://github.com/proompteng/lab/pull/15033); its new image publication was blocked by the registry.
No production constraint was removed manually, no migration was marked complete, and no activation credential
was fabricated. These checks remain part of acceptance rather than being replaced with weaker readiness probes.

The correct source, `fefcf364cbe8683b1a5ce45e0585b79ae7832fe7`, published as
`sha256:b4cce1783a52ddf440413992604e978e021b2a8e601d709077b3ad8145d991cb` after registry recovery.
An older publisher completed first and temporarily occupied Bayn's promotion path. Its Argo operation was terminated
through the native operation control, allowing the already queued correct Freight to proceed. The attempted Kargo
abort conflicted with a resource-version change and was not applied; its previous promotion had already errored.

The correct image initially exceeded its existing 15-minute migration deadline and rolled back. A later startup
completed migrations 97–99 at `11:08:48Z`. Both exact-image controllers then became Ready and reported available
Kafka projections, zero offset lag, and recent BTC, ETH, and SOL quotes. A proposed 30-minute migration budget,
45-minute startup probe, and 60-minute promotion timeout passed isolated tests, but was withdrawn after native
migration completion made it unnecessary for recovery. None of those proposed changes was committed or deployed.
The activation hook still awaits proof of the expected durable controller plan and successor pass. Public Bayn
availability, accounting reconciliation, and trading readiness remain separate acceptance requirements.

The reviewed cash-spot cutover deliberately has no capital activation request and clamps the previous PAPER
authority. Its documented next step is a separately reviewed PAPER mandate bound to the verified account, image,
and current strategy/risk identities. Infrastructure recovery does not supply that mandate or grant live authority.

### Market-data archive and Sealed Secrets web

The retained market-data archive JVM reported a missing Kafka SCRAM callback class after broker recovery. Inspection
of its actual application JAR found the class present. A user-classloader lifecycle problem is a possible explanation,
not a proven packaging defect. No speculative dependency or authentication change was made. Native Kargo promotion
of the existing published Torghut Freight replaced both Flink jobs through their configured savepoint path.
Both jobs reached `RUNNING` and subsequently completed fresh checkpoints in the existing S3 checkpoint store.
An earlier checkpoint failure remains in the archive job's history. No consumer offset reset or checkpoint deletion
was used to obtain a green status.

Sealed Secrets web repeatedly failed with `Exec format error` after placement on ARM64 Altra. The upstream v3.3.2
image's ARM64 descriptor and config contained an amd64 executable: ELF `e_machine` was 62. Restricting that web
Deployment to amd64 restored it. The Sealed Secrets controller, keys, and sealed credentials were unchanged.

## Maintenance mistakes

The maintenance agent missed the existing October 10 XFS runbook before rebooting. That delayed diagnosis of an
already documented risk. The agent also treated the staged configuration resource as evidence that a hard restart
would apply it. Active configuration and mount readback disproved that assumption.

Recovery updates focused on the devbox before physical Turin and shared services had recovered. The user had to
redirect the work to the host and then explicitly prioritize trading. Future maintenance must define the dependency
recovery order before interruption and report actual application availability throughout the outage.

The CSI log misattribution added another avoidable delay. Every storage error must be bound to a volume handle,
PV, PVC, owning controller, and current device mapping before a recovery action is selected. A nearby log line and
an enumerated `/dev/rbdN` name are insufficient evidence.

## Corrective changes delivered

[PR #15034](https://github.com/proompteng/lab/pull/15034) merged as
`cfe63e5491577d5fbb12cc0601dc83fd1779095e` at `09:09:31Z`. The committed template was rendered, validated,
reviewed through an Omni dry run, and synced. Active and persistent Turin configurations then both contained
`VolumeConfig EPHEMERAL provisioning.grow: false`. The live volume retained project quota support.
No further host restart was used to validate that change. Its next-boot behavior remains unverified.

Hermes's egress proxy also failed because `/run/squid/squid.pid` survived a container restart in an `emptyDir`.
The file contained PID 1, causing the next Squid process to report another running instance. Recreating that Pod
restored the proxy. [PR #15039](https://github.com/proompteng/lab/pull/15039), merged as
`620509827a95f879d1149369f1ef70496f081445` at `09:36:10Z`, disables the redundant PID file for the foreground
container process. Image publication and Kargo deployment were still blocked by the registry when this source fix merged.

The normal Hermes toolchain publisher and Kargo promotion later succeeded. Production readback confirmed
`pid_filename none` and no PID file. A restart within the same Pod still needs proof before claiming the PID-file
recurrence is disproved. [PR #15041](https://github.com/proompteng/lab/pull/15041) also fixed placement of the existing disposable
Hermes network-policy probe by admitting the second amd64 node's existing compute taint. Required cross-node
anti-affinity remained in place. The native probe completed with `network_policy_enforced=true`: baseline access,
denied access after policy enforcement, and restored access after the allow rule, using a fresh private image pull.

[PR #15040](https://github.com/proompteng/lab/pull/15040), merged as
`e090b95105785bbb188c3113dd2239aaa17f1839` at `09:52:02Z`, increases only the main External Secrets controller
memory limit from 256 MiB to 1 GiB. Both old replicas were repeatedly OOMKilled with exit 137. The normal Argo
rollout produced two Ready replicas with no restarts, and the existing canary refreshed successfully at
`09:53:26Z`. All 30 ExternalSecrets reported Ready after that rollout. Webhook and certificate-controller limits,
provider identities and Secret values were not changed.

Both original 20 GiB Mimir ingester volumes were snapshotted, repaired offline, and then passed read-only checks
with exit 0. The temporary mappings were removed and the original three-replica StatefulSet and Argo reconciliation
were restored at approximately `09:56Z`. Ingestion readiness still depended on Kafka consumer and replica recovery.

All Mimir ingesters and Tempo V3 live stores later became Ready. Mimir's Kafka replay rejected some older samples
with `err-mimir-sample-timestamp-too-old`; complete historical telemetry recovery is therefore not established.
No acceptance window was weakened, offset reset, or synthetic backfill performed to hide those rejections.

[PR #15043](https://github.com/proompteng/lab/pull/15043), merged as
`010a9096f726efa75b26897691c5195036bd7082` at `11:17:00Z`, pins only Sealed Secrets web to amd64. The rendered
manifests and server dry run passed before merge; the normal Argo rollout produced a Ready web replica.

The requested Turin case-fan setting was restored and read back at 1120 RPM on FAN1, FAN3, FANA, and FANB.
The CPU fan and full-speed pump remained separately controlled; the pump read 3780 RPM. These are observed values,
not a promise of identical RPM under every future thermal condition.

## Recovery state at this revision

The latest checked inventory contained 91 Argo Applications. 87 reported `Synced` and `Healthy`, but three of those
had reconciliation paused, so only 84 met both the health/sync and active-reconciliation acceptance criteria.
Those holds must be resolved against their current owner and intended release before treating cached health as proof.

| Service or dependency | Verified state                                                                                              | Remaining acceptance                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Physical Turin        | Ready, schedulable, original node and four NVMe identities; Kata/GPU checks passed                          | Next boot with committed growth prevention; NVMe disappearance cause                                             |
| Ceph                  | Six original OSDs up/in, three monitors in quorum, all 601 PGs active                                       | 706,079 degraded objects, 32 undersized PGs, two BlueStore slow-operation warnings at approximately 11:27Z       |
| Registry              | Original claim mounted, HTTP 200, immutable publication and fresh pulls restored; maintenance holds removed | Full retained-catalog integrity audit                                                                            |
| Kafka                 | Broker 3 restarted naturally; no unavailable partitions in post-restart native query                        | Continued production replication and input freshness; old RF1 simulation topic configuration is a separate issue |
| Observability         | Mimir and Tempo replicas Ready; original volumes and reconciliation restored                                | Quantify late-sample rejection gap; do not assume complete historical telemetry                                  |
| Market data           | Both Flink jobs running from retained savepoints, with fresh completed checkpoints                          | Session-specific source freshness and archive progress                                                           |
| Bayn                  | Migrations 97–99 committed; exact-image controllers Ready with fresh crypto projections                     | Durable activation completion, public runtime, exact reconciliation, and reviewed PAPER mandate                  |
| External Secrets      | Two controller replicas Ready without OOM recurrence; canary and all 30 ExternalSecrets Ready               | Routine observation at the deployed memory limit                                                                 |
| Sealed Secrets        | Web replica Ready after amd64 placement; controller unchanged                                               | Native web HTTP proof                                                                                            |
| Hermes                | Toolchain publication/promotion and cross-node policy probe succeeded                                       | Same-Pod restart proof                                                                                           |
| Ofz                   | API and playground replicas Ready after their separately owned release                                      | Audit-export replicas crash-looping; coordinate with the release owner                                           |
| Home Stash            | Importer continues processing an existing active Job                                                        | Normal completion; an active CronJob legitimately reports `Progressing`                                          |

Ceph redundancy is improving, but a healthy host and active PGs are not equivalent to complete replication.
No Ceph profile, scrub concurrency, media I/O throttle, OSD identity, or health-warning mute was changed to force
acceptance. No recovery ETA is inferred from object count alone.

## Follow-up actions

| Action                                                                              | State and closure evidence                                                                         |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Preserve Turin project quotas and prevent the repeated startup growth mount         | Delivered in PR #15034 with active and persistent readback; validate at a future authorized boot   |
| Bind CSI errors to exact storage ownership before repair                            | Required recovery procedure; this incident's incorrect registry attribution is explicitly recorded |
| Preserve snapshots and require exclusive offline ownership before filesystem repair | Applied to the registry and both Mimir claims; corrected and clean exit codes retained             |
| Restore registry crash recovery                                                     | Journal added and verified on the original claim; root cause of its missing journal remains open   |
| Remove foreground Squid stale PID-file failure                                      | Source delivered in PR #15039; final production restart proof outstanding                          |
| Fix External Secrets startup OOM                                                    | Delivered and deployed in PR #15040 with native canary proof                                       |
| Restore the existing Hermes policy test on two amd64 nodes                          | Delivered in PR #15041 and native deny/allow proof passed                                          |
| Constrain the mispackaged Sealed Secrets web artifact to its actual architecture    | Delivered and deployed in PR #15043; report upstream packaging defect separately                   |
| Finish Bayn's native activation and verify exact accounting                         | In progress; retain fail-closed checks and current capital authority                               |
| Establish Altra's overlapping reboot cause                                          | Open; its boot timestamp is confirmed, but no causal attribution is justified                      |
| Quantify registry integrity and telemetry gaps                                      | Open; current artifact pulls and replica readiness do not prove historical completeness            |
| Close the incident only after all applications and service-level checks pass        | In progress; keep this report explicit about remaining work                                        |

## Acceptance still required

- Every Argo CD Application must report `Synced` and `Healthy`, with no temporary reconciliation pause left behind.
- Bayn must expose its deployed status, native reconciliation, controller progress, and session readiness.
- Kafka must have no unavailable partitions, and the market-data pipeline must resume with verified timestamps.
- The registry must serve image manifests after a clean offline filesystem check and owner restoration.
- Ceph recovery, residual warnings, and original OSD identities must be recorded explicitly.
- The final report must include service recovery timestamps, remaining uncertainty, and delivered corrective changes.

# Independent Ofz recovery storage

The approved recovery destination is `kalmyk@nuc.ide-newton.ts.net`. This component runs a pinned SeaweedFS 4.48
full image with persistent SQLite metadata in WAL/FULL mode and synchronized object writes. Only its S3 endpoint
is published, on NUC loopback `9445`; private Tailscale HTTPS `9444` forwards to it. The Filer HTTP interface is disabled.
Omni retains ownership of ports `443`, `8090` and `8100`.

The archive bucket uses versioning and ninety-day COMPLIANCE retention. The exporter can upload and read its objects
and inspect retention. It cannot delete objects, change bucket configuration or shorten existing retention. The
independent custodian credentials stay on NUC. Publish only the separate exporter credentials to its managed
Kubernetes Secret through the existing sealed-secret workflow.

Ofz and Keycloak physical PostgreSQL backups use separate `ofz-database-backups` and
`keycloak-database-backups` buckets. Each database has a bucket-scoped writer, distinct from the audit exporter and
custodian. The writers can list, upload, read and logically prune their own backups. They cannot delete immutable
versions, access another bucket or change storage configuration. `database-writers.json` and its fingerprint persist
on NUC. Publish only each database's writer pair as its namespace-scoped SealedSecret.

Both database buckets require versioning, AES256 and thirty-day COMPLIANCE retention. CNPG archives WAL within
sixty seconds and schedules a daily physical base backup. Protected one-off Backup resources establish the first copy
at the new destination; changing an existing ScheduledBackup does not retrigger its initial run. Barman keeps a thirty-five-day
recovery window. Bucket lifecycle expires current objects after forty days and noncurrent versions after forty-five
days. Existing protected versions remain immutable during logical pruning.

New objects require AES256 encryption. A private, atomically persisted 256-bit wrapping key supplies SeaweedFS's
per-object encryption. Its fingerprint prevents preparation from replacing a missing or changed key. Repeated
deployments retain that identity. The key and generated `security.toml` stay on NUC; neither belongs in Kubernetes.
The bucket default encrypts new writes, and the exporter also explicitly requests encryption and checks the returned
immutable version before acknowledging it. Unencrypted versions remain unacknowledged.

## Reviewed deployment

Deploy an archive of a reviewed `main` commit, not a worktree. Include `devices/nuc/ofz-recovery`,
`services/ofz/audit_export.py` and a `.source-sha` receipt containing that exact commit. Select the successfully
published Ofz image from the same commit by its immutable digest after checking the CI/OCI release receipt.
The image supplies the locked Python runtime and SDKs; NUC needs no host SDK installation.

On the verified NUC, set `OFZ_RECOVERY_SOURCE_SHA` to that commit and `OFZ_RECOVERY_TOOLS_IMAGE` to
`registry.ide-newton.ts.net/lab/ofz@sha256:<verified-index-digest>`, then run:

```sh
bash devices/nuc/ofz-recovery/deploy.sh
```

The deployer checks NUC identity, the source archive receipt and the tool image's source revision. It preserves the
initial credential manifest across retries, validates and starts the pinned backend, reads back synchronized storage
configuration, and proves version-specific readback, deletion denial and retention-shortening denial. It changes only
Tailscale port `9444` and compares every other route before and after. Evidence is stored under
`/var/lib/ofz-recovery/evidence`; credentials are under its private `secrets` directory.

The storage proof uses NUC loopback. Host-originated connections to NUC's own Tailscale address can bypass Serve.
Verify certificate identity and authenticated S3 read/write from a different tailnet peer before activating Ofz.
Then qualify the real exporter from its Kubernetes workload, including archive loss, backlog, retry and recovery.
Complete the reviewed NUC encryption update before starting the first production exporter. The earlier storage
release has no wrapping key configured. Its historical qualification versions remain immutable; they are not
production audit checkpoints. The real encryption fixture verifies an eight-MiB multipart object, absence of its
plaintext marker in the backing volume and SQLite, and unchanged readback after SIGKILL.

The server stops accepting data writes when free space falls below 10 GiB. NUC currently has a single 256 GB disk;
measure retained audit and backup growth against available capacity before admitting the full fleet storage budget.
The backend and its data remain on NUC when the Galactic cluster is unavailable. Home backup schedules remain
separate required work.

## Database cutover

1. Hold Ofz reconciliation while the reviewed database destinations change. Keep the existing audit exporter running.
2. Deploy the reviewed NUC source and matching published tool image. Verify the existing audit version and key identity
   still match. The deployed verifier exercises both database writers' encrypted version readback, listing,
   thirty-day retention, version-deletion denial, cross-bucket read/write denial and rejected encryption changes.
3. Reconcile Ofz at its exact Kargo-generated revision. For held Keycloak, sync only the reviewed database Cluster,
   ObjectStore, database writer SealedSecret, ScheduledBackup and protected one-off Backup before upgrading the identity server.
4. Verify both initial physical backups complete, WAL objects arrive encrypted, and the database writers cannot read
   the other database or the audit archive. The initial cutover backups target the primary to force a new checkpoint
   after the archive destination changes. A standby can use an older restartpoint whose WAL exists only in the retired
   archive. Daily backups can prefer a standby after this baseline is established. A successful Backup resource alone
   does not prove recovery.
5. Restore each physical backup and its WAL into an isolated NUC PostgreSQL instance of the pinned production version.
   Verify the expected databases and application state before allowing the identity and runtime cutover.

Do not remove historical Ceph backup objects during this change. They are outside the active backup destination and
retain their existing protection. New recovery must use the independent NUC base backup and WAL.

## Recovery and updates

Keep the private credential manifest and the backend data together. `prepare` never rotates an existing identity.
Recovery also requires `database-writers.json` and its fingerprint. Restore the original pair when either is lost or
changed. The deployer retains a second fingerprint under `evidence` to detect loss of the entire secrets directory.
Recovery also requires the original `secrets/sse_kek` and its `sse_kek.sha256` fingerprint. Restore the approved key
when either is lost or corrupt; do not generate a replacement for existing encrypted data.
An interrupted upload is verified by immutable version and SHA-256 before the control database acknowledges it.
Existing archive versions stay readable after a backend crash; the real fixture kills and restarts the process using
the same disks and client endpoint. A readback or retention mismatch stops acknowledgement and lets Ofz's archive
lag fence deny protected access. Investigate the immutable version before restoring it with the custodian account.

Updates use the next reviewed source and published tool image. Keep the data directory and credential manifest.
The deployer recreates only the archive container; allow its restart to complete before relying on the archive.
Do not prune retained objects or replace the manifest during a source rollback.

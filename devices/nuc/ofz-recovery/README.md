# Independent Ofz audit archive

The approved recovery destination is `kalmyk@nuc.ide-newton.ts.net`. This component runs a pinned SeaweedFS 4.48
full image with persistent SQLite metadata in WAL/FULL mode and synchronized object writes. Only its S3 endpoint
is published, on NUC loopback `9445`; private Tailscale HTTPS `9444` forwards to it. The Filer HTTP interface is disabled.
Omni retains ownership of ports `443`, `8090` and `8100`.

The archive bucket uses versioning and ninety-day COMPLIANCE retention. The exporter can upload and read its objects
and inspect retention. It cannot delete objects, change bucket configuration or shorten existing retention. The
independent custodian credentials stay on NUC. Publish only the separate exporter credentials to its managed
Kubernetes Secret through the existing sealed-secret workflow.

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

The server stops accepting data writes when free space falls below 10 GiB. NUC currently has a single 256 GB disk;
measure retained audit and backup growth against available capacity before admitting the full fleet storage budget.
The backend and its data remain on NUC when the Galactic cluster is unavailable. This layer establishes audit storage;
database WAL/base backups, home backup schedules and clean-environment restore remain separate required work.

## Recovery and updates

Keep the private credential manifest and the backend data together. `prepare` never rotates an existing identity.
An interrupted upload is verified by immutable version and SHA-256 before the control database acknowledges it.
Existing archive versions stay readable after a backend crash; the real fixture kills and restarts the process using
the same disks and client endpoint. A readback or retention mismatch stops acknowledgement and lets Ofz's archive
lag fence deny protected access. Investigate the immutable version before restoring it with the custodian account.

Updates use the next reviewed source and published tool image. Keep the data directory and credential manifest.
The deployer recreates only the archive container; allow its restart to complete before relying on the archive.
Do not prune retained objects or replace the manifest during a source rollback.

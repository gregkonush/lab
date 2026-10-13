# Prepared Ofz HA

The active parent excludes this overlay. It combines the existing SpiceDB/database resources with the two-replica
Ofz API and its managed control databases. Activate through the existing GitOps application during the coordinated
cutover, after the independent recovery, migrated graph and credential gates pass.

SpiceDB's read and write pools use separate limits. The prepared limits are ten reads and four writes per replica.
Four native replicas during a rolling surge consume at most 56 connections. Simultaneous three-replica rolling surges
for Ofz, Tengri and the BFF consume at most 42, 36 and 24 connections respectively. Six supervisors consume twelve.
The total is 170, leaving thirty of PostgreSQL's 200 connections for the exporter, migrations, replication and operations.
Set the corresponding database role limits during bootstrap; an API role limit must include its third rolling replica.
Keycloak has its own database with a separate 100-connection budget.

Both dispatch caches stay disabled because the real expiry qualification returned stale authorization with them enabled.
Ofz independently verifies the database-clock grant deadline. Re-enabling either cache requires fresh expiration and
revocation qualification. The operator's [documented camel-case flag mapping](https://authzed.com/docs/spicedb/ops/operator)
and the pinned SpiceDB 1.56.2 binary identify the configured pool and cache options.

Run `bash services/ofz/test-ha-manifests.sh` from the repository root. It renders all four prepared targets, validates
their schemas and checks critical HA/credential/network contracts against the rendered resources. Server-side dry run
and isolated failover checks are recorded in the implementation checklist; they do not establish deployed acceptance.

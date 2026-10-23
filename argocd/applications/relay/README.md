# Relay private deployment — stage 2

This application prepares the private Relay gateway in the existing `tengri` namespace. It has no public ingress,
Connections UI or BFF endpoint. `RELAY_DISPATCH_ENABLED=false` and an empty reviewed provider catalog prevent account
activation. Stage 1 (#15300) must complete its coordinated production qualification before a connector canary.

## Prepared infrastructure

- Two non-root replicas, one rolling surge, a disruption budget and exact BFF SPIFFE mTLS on 8443.
- A checksum-bound migration hook using `relay_migrator`; serving pods mount only `relay_runtime` credentials.
- Separate password/keyring Secret projections from the `infra` 1Password vault. Missing keys fail startup.
- A dedicated retained `relay_control` database on the existing HA Ofz PostgreSQL cluster. A prepared overlay adds
  nonprivileged owner/runtime roles while preserving every existing role and the 220-connection limit.
- Four pooled connections per serving replica, at most twelve during surge; the runtime role permits sixteen and
  the migration role permits two. Existing role limits plus these roles remain below the server budget.
- Restricted ingress and egress for DNS, Ofz and PostgreSQL. Health is for node probes. There is no provider HTTPS
  egress while the catalog is empty. Add reviewed provider destinations before a canary; retain old revocation
  destinations until queued jobs and relevant backups no longer need them.
- Main-only immutable images, a receipt-validating Warehouse, `kargo/relay` Stage and exact Application authorization.

The ApplicationSet entry is disabled and Relay's exact automatic promotion policy is held. The live Ofz application
still renders `argocd/applications/ofz`; the prepared `argocd/applications/ofz-relay-stage2` overlay is not selected.
This prevents missing new credentials from disrupting the current authority database.

## Secret inputs

Provision one item named `relay-runtime` in the existing `infra` 1Password vault:

| Field | Value and destination |
| --- | --- |
| `keyring` | Private JSON `{"active":"v1","keys":{"v1":"<base64 of 32 cryptographically random bytes>"}}`; projected only to `tengri/relay-keyring`. |
| `runtime-password` | Independent random database password for `relay_runtime`; projected to the Ofz role manager and Relay serving namespace. |
| `migrator-password` | Independent random database password for `relay_migrator`; projected to the Ofz role manager and migration hook. |

Use the existing approved 1Password provisioning identity. This source change does not generate vault keys or assume
write access to that vault. Do not paste values into chat, commit plaintext, copy the database CA private key, or rotate
an existing encryption key merely to make startup succeed. The existing `ofz-database-ca` projection supplies only the
public PostgreSQL CA certificate to Tengri.

## Rollout order and proof

1. Verify stage 1's exact qualified cohort and current Ofz migration checksums. Provision/confirm the 1Password fields.
2. In a reviewed main change, select `argocd/applications/ofz-relay-stage2` as Ofz's ApplicationSet path. The existing
   Ofz Kargo Stage continues writing the base image/config inputs consumed by that overlay. Keep the native connector
   flags off. Let the normal coordinated image cohort and Ofz promotion reconcile the new database and roles.
3. Verify both Ofz ExternalSecrets are Ready, all three database instances are Ready, the dedicated database is owned
   by `relay_migrator`, existing application roles remain intact, and no connection budget changed unexpectedly.
4. After the storage prerequisite is proven, enable the Relay ApplicationSet entry and its exact automatic promotion
   policy in reviewed main. Keep `RELAY_DISPATCH_ENABLED=false`, the catalog empty, and the BFF endpoint absent.
5. Require the successful immutable Relay build receipt, selected Freight, generated `kargo/relay` commit, migration
   hook and healthy rollout. Compare both running image IDs to the selected digest/platform child digest.
6. From the existing BFF workload identity, call the private `POST /v1/request` with `{"command":{"action":"providers"}}`.
   Require 503 and `connectors are not enabled`. Prove that another SPIFFE identity is denied at TLS and a guest cannot
   reach the service. Compare database row counts before/after the disabled request; they must not change.

The native SpiceDB schema migration, provider applications, catalog operations/egress, BFF routes, eligibility and
read-only account canary are subsequent activation work. No bootstrap rerun or connector grant creation belongs to
this private provisioning step. A healthy private pod does not establish that any account is connected.

## Validation

From the repository root, using the pinned toolchain:

```sh
kustomize build argocd/applications/relay > /tmp/relay.yaml
kustomize build argocd/applications/ofz-relay-stage2 > /tmp/ofz-relay.yaml
kustomize build argocd/applications/kargo > /tmp/kargo.yaml
bash scripts/kubeconform.sh /tmp/relay.yaml /tmp/ofz-relay.yaml /tmp/kargo.yaml
python3 services/ofz/tests/inventory.py
python3 -m unittest discover -s services/ofz/tests -p 'test_*.py'
cargo test --manifest-path services/relay/Cargo.toml --locked --all-targets
bash services/relay/test-integration.sh
```

The integration fixture covers actual TLS PostgreSQL, OAuth/API/MCP/GraphQL providers, runtime-role restrictions,
refresh/disconnect races, key rotation and revocation across catalog/secret changes. It uses disposable accounts.

## Recovery

Keep dispatch disabled and the BFF endpoint absent. For an image defect, re-promote a previously proven compatible
Relay Freight through Kargo; keep the dedicated database, encrypted queue and original keyring. Never prune the database,
overwrite migration checksums, remove old decryption keys needed by replicas/backups, or regenerate a missing key.
If storage provisioning fails, leave Relay enrollment held and fix the reviewed overlay/secret input. Preserve existing
Ofz roles, relationships, native schema and bootstrap journal.

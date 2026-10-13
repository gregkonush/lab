# Ofz controller cutover configuration

Render with `kustomize build argocd/prepared/tengri`. The active application excludes this overlay while the new
Ofz API and credentials are being provisioned. The image-publication hold does not prevent configuration-only
rollouts; move this configuration into the Kargo-managed parent only with those dependencies ready.

The target removes the direct SpiceDB key, old runtime secret and ConfigMap nonce state. Required namespace-local
Secrets are `tengri-internal-request-key` (`TENGRI_INTERNAL_HMAC_SECRET`), `tengri-controller-db` and
`tengri-supervisor-db` (`password`), and `ofz-database-ca` (`ca.crt`). Both database roles require the migrated
`tengri_control` schema. Ofz listens at `ofz-api.ofz.svc.cluster.local:9443`; the controller and supervisors reach
only their required endpoints. The BFF receives the same request key through its own namespace-local Secret.

Existing workspaces and homes were deleted with explicit authorization on 2026-10-13. No retained-data import or
migration rehearsal is needed. Keep the `tengri-ofz-cutover` creation fence until the new authority is deployed,
then remove its policy and binding and verify fresh workspace creation. Images remain owned by Kargo.

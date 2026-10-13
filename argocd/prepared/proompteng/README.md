# Ofz BFF cutover configuration

Render with `kustomize build argocd/prepared/proompteng`. The active application excludes this overlay until Ofz,
Keycloak, the migrated TLS database and namespace-local credentials are ready for the coordinated image cutover.
It supplies the complete required auth configuration and network paths; there is no runtime fallback.

Required Secrets are `tengri-internal-request-key` (`TENGRI_INTERNAL_HMAC_SECRET`), `tengri-oidc-client`
(`client-secret`), `tengri-bff-db` (`password`), and `ofz-database-ca` (`ca.crt`). The request key must match the
controller, and the OIDC client credential must match Keycloak's confidential Tengri client. The fixed ingress
address is only the connection target; TLS still verifies `auth.proompteng.ai`.

Move this configuration into the existing Kargo-managed parent when the dependencies and reviewed images are ready.
Remove the old Better Auth secret through that change. Verify sign-in and fresh workspace creation after deployment.

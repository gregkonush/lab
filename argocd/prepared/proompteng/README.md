# Prepared Ofz BFF

The active parent excludes this overlay. It renders two BFF replicas on different hosts with a one-replica disruption
minimum. Removing the ARM64 selector permits the existing multi-architecture image to use all three cluster hosts;
the cluster has only one ARM64 host. A rolling surge can therefore schedule without co-locating the two serving replicas.

Cutover requires namespace-local `tengri-internal-request-key` with `TENGRI_INTERNAL_HMAC_SECRET`, `tengri-oidc-client`
with `client-secret`, `tengri-bff-db` with `password`, and `ofz-database-ca` with `ca.crt`. The OIDC credential must equal
Keycloak's reviewed confidential Tengri client secret. The old Better Auth/GitHub secret is excluded from the target.
The pinned ingress address is reached while TLS verifies `auth.proompteng.ai`; it does not replace the issuer identity.

Render with `kustomize build argocd/prepared/proompteng`. P8 moves this configuration into the existing
Kargo-owned parent during the coordinated release. Independent recovery and deployed browser acceptance remain gates.

# Prepared Keycloak HA

The active parent excludes this overlay. It preserves the existing database, master realm, Headlamp and Agents Shell
bootstrap definitions and adds the dedicated Tengri realm. Activate only during the coordinated migration after the
independent backup and restore gates pass. The prepared database has three host-spread instances, one required
synchronous standby and a 100-connection budget. Each of the two servers uses at most 20 database connections.

The servers use Keycloak 26.7.4, JDBC discovery and embedded transport mTLS. StatefulSet Pod and node names identify
the cache topology. Required host anti-affinity and a one-replica disruption minimum retain one serving instance during
maintenance. Database TLS verifies the reviewed DNS name against the mounted `keycloak-db-ca` Secret's `ca.crt`.

The prepared certificate uses the existing DNS-01 `letsencrypt-prod` ClusterIssuer for `auth.proompteng.ai`.
Traefik exposes only HTTPS and forwards to the server's private HTTP listener. The server NetworkPolicy admits that
listener only from Traefik and the existing bootstrap jobs, and admits transport ports only from Keycloak servers.
Keep the issuer hostname fixed; the BFF and Ofz verify it while connecting to the reviewed internal ingress address.

The isolated fixture runs two production-mode servers with these cache and database TLS settings. It verifies their
two-member cluster and kills the serving process during a passkey challenge. Authentication completes on the survivor
with the same subject and credential identities within 30 seconds. This does not prove Kubernetes node loss, CNPG
switchover or independent recovery; those remain deployment qualification gates.

The patch release and caching behavior are documented by the [Keycloak release notes](https://www.keycloak.org/2026/09/keycloak-2674-released)
and the [versioned caching guide](https://github.com/keycloak/keycloak/blob/26.7.4/docs/guides/server/caching.adoc).
Render with `kustomize build argocd/prepared/keycloak` before the reviewed cutover.

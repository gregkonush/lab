# Dedicated Tengri identity realm

The active Keycloak kustomization includes this dedicated realm and its sealed credentials.
It preserves the master realm, Headlamp and Agents Shell clients.

`bootstrap.py` imports only a new, initially disabled realm. It locks managed profile attributes, verifies the GitHub
provider, exact client callbacks, protocol mappers, required actions and authentication flows before enabling it.
Repeat runs verify configuration and fail on drift outside the managed login theme and WebAuthn user-verification
policy. After verification they reconcile those settings and the mounted GitHub and BFF client secrets through the
administrator API, then verify the realm settings and BFF secret readback. They preserve users, passkeys and broker
links. The isolated browser fixture migrates the former PIN-required policy, rotates both secrets after passkey
enrollment, rejects the old BFF secret and completes a fresh login using the rotated GitHub and BFF credentials.

The dedicated `tengri` login theme extends Keycloak's built-in theme. Its registration module uses Keycloak 26.7.4's
WebAuthn implementation and default authenticator label without calling `window.prompt()`, which embedded browsers
reject after creating the credential. The real browser fixture disables prompts, enrolls passkeys, then disables user
verification for subsequent authentication. It verifies that theme and PIN-policy migration preserve existing
credentials while other security drift still fails.
The upstream module retains its [Apache 2.0 license](theme/LICENSE.txt).

GitHub's numeric profile ID is copied by its built-in broker mapper into an administrator-only `github_id` attribute.
The username derives from that ID. Email does not link accounts or grant authority. The broker session's provider note
is included in the ID token. The account clients, direct grants, implicit flow and refresh tokens are disabled.
The BFF requires PKCE S256; the realm and client both require authentication level two. The post-broker flow requires
a fresh passkey assertion with physical presence, with passkey enrollment required on first login. WebAuthn user
verification is `discouraged`, so a YubiKey can authenticate with a touch without a PIN check. The key's PIN remains
available for other services. Browser or authenticator policies may still request verification, including during
discoverable-credential enrollment; the realm does not require it.

The existing GitHub OAuth client's ID/secret are sealed into `keycloak-tengri-broker`. Before enabling the BFF,
replace the OAuth app's callbacks with `https://auth.proompteng.ai/realms/tengri/broker/github/endpoint`, and mount
the same confidential BFF client secret in both services. The issuer must have a valid HTTPS certificate.
The hard cutover removes the direct GitHub/Better Auth path; there is no fallback login mode.

The client includes Keycloak's `basic` scope for the signed authentication time and `acr` scope for achieved assurance.
Ofz independently requires both. The configuration was checked against Keycloak 26.7.4 source and tested through its
real administrator API, including repeat verification. The isolated Chromium fixture completed GitHub brokerage,
passkey enrollment, fresh verification, numeric identity separation, admission/assurance denial and Ofz session revocation.
Real custodian enrollment, HA and deployed identity readback remain separate migration gates.
Fixture providers may substitute an isolated GitHub HTTP service;
the production verifier rejects provider endpoint overrides.

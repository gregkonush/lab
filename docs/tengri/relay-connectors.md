# Relay connector gateway

Status: implementation contract for the connector gateway. The existing Relay PR #14822 is an unmerged MCP-only
prototype and is not the production architecture. This document is not a claim that Relay is deployed.

## Product contract

Users connect an external account once, select the operations and resources available to each workspace, and can
disconnect it without entering the guest. Provider credentials never enter an agent home, Codex configuration,
browser storage, API response, telemetry, or an Ofz policy tuple. A connection is reusable across workspaces;
revoking one workspace's access does not disconnect the account from other workspaces.

Protocol and authentication are independent. Protocol adapters implement remote MCP and named HTTP API operations;
an HTTP adapter also supports GraphQL through a reviewed POST operation. Authentication supports unauthenticated
public endpoints, static bearer tokens, API-key headers, and OAuth2 authorization-code/PKCE or client-credentials
flows. OAuth is not a protocol adapter. Provider definitions are operator-reviewed configuration, not arbitrary URLs
or executable code supplied by an agent.

```mermaid
flowchart LR
    Browser[Connections UI] --> BFF[Authenticated BFF]
    Agent[Agent connector client] --> Gateway[Authenticated request boundary]
    BFF --> Relay[Relay execution service]
    Gateway --> Relay
    Relay --> Ofz[Canonical Ofz API]
    Relay --> SQL[PostgreSQL: metadata and encrypted credentials]
    Relay --> MCP[MCP adapter]
    Relay --> HTTP[HTTP API adapter]
    MCP --> Provider[Reviewed external provider]
    HTTP --> Provider
```

## Records and authority

- A provider definition specifies immutable ID/version, protocol, fixed HTTPS destination, operations and JSON
  argument schemas, authentication options, OAuth endpoints, client identity, and provider scopes.
- A connection has an immutable UUID, owner, provider/version, display name, status, granted scopes and encrypted
  credentials. Public projections contain no token or credential ciphertext.
- A workspace binding selects connection, exact workspace UID, allowed operations and resource constraints.
  A binding never substitutes for the canonical Ofz workspace and connector authorization checks.
- Ofz owns platform membership, connection authority, delegation, current workspace/runtime authority and revocation.
  Relay does not receive the SpiceDB administrative key or recreate the old Relay ownership graph.
- Human operations enter through the authenticated BFF. Agent operations require an authenticated, runtime-bound
  request boundary; possession of a connection UUID, workspace name or claimed actor ID grants no access.

## Credential storage

Use dedicated PostgreSQL tables and a least-privilege runtime role. Encrypt credential JSON using AES-256-GCM,
with a fresh random 96-bit nonce on every write. Associated data binds connection UUID, owner, provider and key
version, preventing ciphertext substitution across accounts. The database holds ciphertext, nonce and key ID;
the encryption key is mounted separately from the database and excluded from its backups. Missing keys, unknown
versions, authentication failures and incomplete credential records fail closed.

Key rotation installs a new active encryption key while retaining decrypt-only old keys until all records and
retained backups have migrated or expired. Never silently regenerate a missing key. Database TLS verifies the
server name. Provider application credentials are backend-only configuration; user access and refresh tokens live
in the encrypted store rather than one Kubernetes Secret containing every user's tokens.

## OAuth lifecycle

Authorization-code attempts use S256 PKCE, random state, exact registered callback URIs, a short database-clock
expiry and one-use consumption. Bind attempts to the authenticated owner, session, provider and connection;
OAuth callbacks must not become a cross-site request-forgery bypass. Exchange codes on the server and never send
tokens to the browser. Reject expanded or unexpected provider scopes. An omitted initial scope means the requested scope; an omitted refresh scope retains the existing grant.

Persist access token, optional refresh token, provider scopes and expiry atomically. Coordinate refresh with a
durable per-connection compare-and-swap claim across replicas. Re-read after claiming refresh, use a bounded request deadline,
preserve an old refresh token only when the provider omits a replacement, and atomically install a rotated token.
An uncertain refresh never blindly retries a consumed rotating token. Invalid grants mark the connection as
requiring reconnection. Client-credentials flows obtain a new access token rather than assuming a refresh token.

Disconnect denies new dispatch before attempting provider revocation. Pending authorization attempts are cancelled;
encrypted credentials are erased. Failed provider revocation remains recorded and retryable without restoring local
access. Already dispatched provider requests cannot be undone by local disconnect.

## Execution and performance

Validate a named operation and schema before resolving credentials. Check current Ofz authority and workspace
binding immediately before dispatch, including after OAuth refresh or MCP initialization. Reject unsupported
operations and unapproved destinations. HTTP methods alone do not determine whether an operation mutates data.
Mutations need explicit `ConnectorInvoke` grants. Use provider idempotency when the reviewed operation supports it; never automatically replay a mutation after
an uncertain response.

Use shared bounded clients, compiled schemas per provider version, per-workspace and global concurrency limits,
response byte limits and end-to-end deadlines. Pin validated public destination addresses and reject redirects,
private/mixed DNS answers and ambient proxy use. Connection reuse must retain destination validation, account
isolation and credential-rotation semantics. Parse MCP SSE incrementally without rescanning old frames.

Record connection ID, workspace UID, operation, outcome, receipt and latency; exclude credentials, arguments and
response bodies. Benchmark warmed HTTP and MCP calls, refresh contention across replicas, slow upstreams and
large fragmented responses. For production qualification, report p50/p95/p99 gateway overhead separately from provider latency.
No production throughput claim is established by the correctness fixture.

## Acceptance and delivery

The implementation must exercise the actual UI/BFF, service, PostgreSQL, OAuth provider fixture, MCP/HTTP provider
fixtures and agent request boundary. Cover owner isolation, wrong workspace/runtime, grants and membership
revocation, disconnect racing a request, token refresh/rotation, callback replay, SSRF, credential leakage,
restarts and concurrent replicas. Unit mocks alone do not establish end-to-end completion.

Ship through reviewed main, immutable image publication, Kargo promotion and Argo reconciliation. Provider setup,
database roles, encryption keys and registered callbacks are explicit deployment inputs. A successful test fixture
or source merge is not evidence of a production rollout or a real provider account connection.

## Implemented boundaries

The implementation and operating inputs are documented in [Relay's README](../../services/relay/README.md).
Connections Settings creates accounts, authorizes them, selects operations and resource constraints, and installs the
agent client. The guest holds a stable P-256 proof key and a one-hour scoped native grant; the provider credential
stays encrypted in Relay. Clearing the selected operations removes the client and revokes matching native grants.
The exact-body DPoP boundary binds the capability, proof key, endpoint, method and request bytes with shared SQL replay
protection. Read and mutation grants are separate, and both recheck the current issuer and runtime before dispatch
and result disclosure. Unconfirmed mutations are recorded as unknown and never automatically retried.

Validation is layered: the browser exercises compact Settings with controlled BFF responses; BFF tests use actual
SPIFFE TLS; Relay integration uses actual TLS providers and PostgreSQL; native Ofz tests use actual PostgreSQL and
SpiceDB; guest tests exercise supervisor configuration, signed requests and private-file permissions. These tests do
not establish a production provider login or a single deployed browser-to-provider acceptance run. Activation still
requires provider registration, secrets, native schema installation and normal GitOps enrollment.

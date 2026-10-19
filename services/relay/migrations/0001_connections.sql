CREATE SCHEMA relay;
CREATE TABLE relay.schema_version (version integer PRIMARY KEY CHECK (version=1), checksum bytea NOT NULL);
CREATE TABLE relay.connections (
    id uuid PRIMARY KEY,
    owner_id text NOT NULL CHECK (owner_id ~ '^[0-9a-f]{64}$'),
    provider_id text NOT NULL,
    provider_version text NOT NULL,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 128),
    status text NOT NULL CHECK (status IN ('pending','connected','refreshing','reconnect','disconnected')),
    credential jsonb,
    scopes text[] NOT NULL DEFAULT '{}',
    expires_at timestamptz,
    version bigint NOT NULL DEFAULT 1,
    refresh_started_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ON relay.connections(owner_id,created_at,id);
CREATE TABLE relay.oauth_attempts (
    state_hash bytea PRIMARY KEY,
    connection_id uuid NOT NULL REFERENCES relay.connections(id),
    owner_id text NOT NULL,
    session_hash bytea NOT NULL,
    secret jsonb NOT NULL,
    expires_at timestamptz NOT NULL,
    consumed boolean NOT NULL DEFAULT false
);
CREATE INDEX ON relay.oauth_attempts(expires_at);
CREATE TABLE relay.workspace_bindings (
    connection_id uuid NOT NULL REFERENCES relay.connections(id),
    workspace_uid uuid NOT NULL,
    operations text[] NOT NULL,
    constraints jsonb NOT NULL DEFAULT '{}',
    version bigint NOT NULL DEFAULT 1,
    PRIMARY KEY(connection_id,workspace_uid)
);
CREATE TABLE relay.invocations (
    id uuid PRIMARY KEY,
    connection_id uuid NOT NULL REFERENCES relay.connections(id),
    workspace_uid uuid,
    operation text NOT NULL,
    receipt_id text NOT NULL,
    outcome text NOT NULL CHECK (outcome IN ('started','succeeded','failed','unknown','withheld')),
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz
);
CREATE TABLE relay.revocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    connection_id uuid NOT NULL REFERENCES relay.connections(id),
    credential jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','complete')),
    attempts integer NOT NULL DEFAULT 0,
    next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- Create role relay_runtime separately; migrations run as the schema owner.
CREATE TABLE relay.agent_cleanups (
    connection_id uuid NOT NULL REFERENCES relay.connections(id),
    workspace_uid uuid NOT NULL,
    PRIMARY KEY(connection_id,workspace_uid)
);
GRANT USAGE ON SCHEMA relay TO relay_runtime;
GRANT SELECT ON relay.schema_version TO relay_runtime;
GRANT SELECT,INSERT,UPDATE ON relay.connections,relay.oauth_attempts,relay.workspace_bindings,relay.invocations TO relay_runtime;
GRANT DELETE ON relay.oauth_attempts,relay.workspace_bindings TO relay_runtime;
GRANT SELECT,INSERT,UPDATE,DELETE ON relay.revocations TO relay_runtime;
GRANT SELECT,INSERT,DELETE ON relay.agent_cleanups TO relay_runtime;

CREATE TABLE relay.grant_installations (
    grant_id uuid PRIMARY KEY,
    connection_id uuid NOT NULL REFERENCES relay.connections(id),
    workspace_uid uuid NOT NULL,
    status text NOT NULL CHECK (status IN ('pending','active','cancelled','revoked')),
    expires_at timestamptz NOT NULL,
    revoke_after timestamptz NOT NULL DEFAULT clock_timestamp()+interval '2 minutes'
);
GRANT SELECT,INSERT,UPDATE,DELETE ON relay.grant_installations TO relay_runtime;

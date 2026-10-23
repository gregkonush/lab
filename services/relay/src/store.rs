use anyhow::{Context, Result, ensure};
use chrono::{DateTime, Utc};
use deadpool_postgres::{Manager, Pool};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{env, time::Duration};
use tokio_postgres::{Config, Row, config::SslMode};
use tokio_postgres_rustls::MakeRustlsConnect;
use uuid::Uuid;

use crate::crypto::Envelope;

#[derive(Clone)]
pub struct Store {
    pub pool: Pool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    pub id: Uuid,
    pub owner_id: String,
    pub provider_id: String,
    pub provider_version: String,
    pub name: String,
    pub status: String,
    pub scopes: Vec<String>,
    pub expires_at: Option<DateTime<Utc>>,
    pub version: i64,
    #[serde(skip)]
    pub credential: Option<Envelope>,
}

impl Connection {
    fn from_row(row: Row) -> Result<Self> {
        let secret: Option<serde_json::Value> = row.get("credential");
        Ok(Self {
            id: row.get("id"),
            owner_id: row.get("owner_id"),
            provider_id: row.get("provider_id"),
            provider_version: row.get("provider_version"),
            name: row.get("name"),
            status: row.get("status"),
            scopes: row.get("scopes"),
            expires_at: row.get("expires_at"),
            version: row.get("version"),
            credential: secret
                .map(serde_json::from_value)
                .transpose()
                .context("invalid encrypted credential")?,
        })
    }
}

impl Store {
    pub async fn reencrypt(&self, vault: &crate::crypto::Vault) -> Result<usize> {
        let mut changed = 0;
        loop {
            let mut client = self.pool.get().await?;
            let tx = client.transaction().await?;
            let rows=tx.query("SELECT * FROM relay.connections WHERE credential IS NOT NULL AND credential->>'key_id' IS DISTINCT FROM $1 ORDER BY id LIMIT 16 FOR UPDATE SKIP LOCKED", &[&vault.active_key_id()]).await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let connection = Connection::from_row(row)?;
                let raw = vault.decrypt(
                    connection.id,
                    &connection.owner_id,
                    &connection.provider_id,
                    connection
                        .credential
                        .as_ref()
                        .context("missing encrypted credential")?,
                )?;
                let envelope = vault.encrypt(
                    connection.id,
                    &connection.owner_id,
                    &connection.provider_id,
                    &raw,
                )?;
                tx.execute(
                    "UPDATE relay.connections SET credential=$1,version=version+1 WHERE id=$2",
                    &[&serde_json::to_value(envelope)?, &connection.id],
                )
                .await?;
                changed += 1;
            }
            tx.commit().await?;
        }
        // Attempts contain PKCE verifiers and must remain decryptable across key rotation too.
        loop {
            let mut client = self.pool.get().await?;
            let tx = client.transaction().await?;
            let rows=tx.query("SELECT a.state_hash,a.connection_id,a.owner_id,a.secret,c.provider_id FROM relay.oauth_attempts a JOIN relay.connections c ON c.id=a.connection_id WHERE a.secret->>'key_id' IS DISTINCT FROM $1 LIMIT 16 FOR UPDATE OF a SKIP LOCKED", &[&vault.active_key_id()]).await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let id: Uuid = row.get(1);
                let owner: String = row.get(2);
                let provider = format!("{}:oauth-attempt", row.get::<_, String>(4));
                let envelope = serde_json::from_value(row.get(3))?;
                let raw = vault.decrypt(id, &owner, &provider, &envelope)?;
                let encrypted = vault.encrypt(id, &owner, &provider, &raw)?;
                tx.execute(
                    "UPDATE relay.oauth_attempts SET secret=$1 WHERE state_hash=$2",
                    &[&serde_json::to_value(encrypted)?, &row.get::<_, Vec<u8>>(0)],
                )
                .await?;
                changed += 1;
            }
            tx.commit().await?;
        }
        loop {
            let mut client = self.pool.get().await?;
            let tx = client.transaction().await?;
            let rows=tx.query("SELECT r.connection_id,r.credential,c.owner_id,c.provider_id,r.id FROM relay.revocations r JOIN relay.connections c ON c.id=r.connection_id WHERE r.credential->>'key_id' IS DISTINCT FROM $1 LIMIT 16 FOR UPDATE OF r SKIP LOCKED", &[&vault.active_key_id()]).await?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                let id: Uuid = row.get(0);
                let owner: String = row.get(2);
                let provider: String = row.get(3);
                let raw =
                    vault.decrypt(id, &owner, &provider, &serde_json::from_value(row.get(1))?)?;
                let envelope = vault.encrypt(id, &owner, &provider, &raw)?;
                tx.execute(
                    "UPDATE relay.revocations SET credential=$1 WHERE id=$2",
                    &[&serde_json::to_value(envelope)?, &row.get::<_, Uuid>(4)],
                )
                .await?;
                changed += 1;
            }
            tx.commit().await?;
        }
        let remaining:i64=self.pool.get().await?.query_one("SELECT (SELECT count(*) FROM relay.connections WHERE credential IS NOT NULL AND credential->>'key_id' IS DISTINCT FROM $1)+(SELECT count(*) FROM relay.oauth_attempts WHERE secret->>'key_id' IS DISTINCT FROM $1)+(SELECT count(*) FROM relay.revocations WHERE credential->>'key_id' IS DISTINCT FROM $1)", &[&vault.active_key_id()]).await?.get(0);
        ensure!(
            remaining == 0,
            "key rotation is incomplete; retain old keys and retry after concurrent updates finish"
        );
        Ok(changed)
    }
    pub async fn from_environment() -> Result<Self> {
        let mut config: Config = env::var("RELAY_DATABASE_DSN")?.parse()?;
        ensure!(
            config.get_ssl_mode() == SslMode::Require && config.get_password().is_none(),
            "database requires TLS and a mounted password file"
        );
        let password = zeroize::Zeroizing::new(
            tokio::fs::read_to_string(env::var("RELAY_DATABASE_PASSWORD_FILE")?).await?,
        );
        config
            .password(password.trim_end())
            .connect_timeout(Duration::from_secs(3))
            .application_name("relay");
        config.options("-c statement_timeout=5000 -c lock_timeout=2000 -c idle_in_transaction_session_timeout=5000");
        let mut roots = rustls::RootCertStore::empty();
        let ca = tokio::fs::read(env::var("RELAY_DATABASE_CA_FILE")?).await?;
        for cert in rustls_pemfile::certs(&mut ca.as_slice()) {
            roots.add(cert?)?;
        }
        ensure!(!roots.is_empty(), "database CA is empty");
        let tls = MakeRustlsConnect::new(
            rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth(),
        );
        Self::new(config, tls)
    }
    pub fn new(config: Config, tls: MakeRustlsConnect) -> Result<Self> {
        let pool = Pool::builder(Manager::new(config, tls))
            .max_size(4)
            .wait_timeout(Some(Duration::from_secs(1)))
            .runtime(deadpool_postgres::Runtime::Tokio1)
            .build()?;
        Ok(Self { pool })
    }
    pub async fn migrate(&self) -> Result<()> {
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;
        tx.execute("SELECT pg_advisory_xact_lock(7245893)", &[])
            .await?;
        let exists: bool = tx
            .query_one(
                "SELECT to_regclass('relay.schema_version') IS NOT NULL",
                &[],
            )
            .await?
            .get(0);
        let checksum =
            Sha256::digest(include_bytes!("../migrations/0001_connections.sql")).to_vec();
        if !exists {
            tx.batch_execute(include_str!("../migrations/0001_connections.sql"))
                .await?;
            tx.execute(
                "INSERT INTO relay.schema_version VALUES(1,$1)",
                &[&checksum],
            )
            .await?;
        }
        let row = tx
            .query_one("SELECT version,checksum FROM relay.schema_version", &[])
            .await?;
        ensure!(
            row.get::<_, i32>(0) == 1 && row.get::<_, Vec<u8>>(1) == checksum,
            "Relay schema mismatch"
        );
        tx.commit().await?;
        Ok(())
    }
    pub async fn verify(&self) -> Result<()> {
        let row = self
            .pool
            .get()
            .await?
            .query_one("SELECT version,checksum FROM relay.schema_version", &[])
            .await?;
        ensure!(
            row.get::<_, i32>(0) == 1
                && row.get::<_, Vec<u8>>(1)
                    == Sha256::digest(include_bytes!("../migrations/0001_connections.sql"))
                        .to_vec(),
            "Relay schema mismatch"
        );
        Ok(())
    }
    pub async fn create(
        &self,
        id: Uuid,
        owner: &str,
        provider: &str,
        version: &str,
        name: &str,
    ) -> Result<Connection> {
        ensure!(
            name.len() <= 128 && !name.trim().is_empty(),
            "invalid connection name"
        );
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;
        tx.execute(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            &[&owner],
        )
        .await?;
        if let Some(row) = tx
            .query_opt("SELECT * FROM relay.connections WHERE id=$1", &[&id])
            .await?
        {
            let existing = Connection::from_row(row)?;
            ensure!(
                existing.owner_id == owner
                    && existing.provider_id == provider
                    && existing.provider_version == version
                    && existing.name == name,
                "connection UUID already registered"
            );
            tx.commit().await?;
            return Ok(existing);
        }
        let count:i64 = tx.query_one("SELECT count(*) FROM relay.connections WHERE owner_id=$1 AND status<>'disconnected'", &[&owner]).await?.get(0);
        ensure!(count < 128, "connection capacity reached");
        let row = tx.query_one("INSERT INTO relay.connections(id,owner_id,provider_id,provider_version,name,status) VALUES($1,$2,$3,$4,$5,'pending') ON CONFLICT(id) DO UPDATE SET id=excluded.id WHERE relay.connections.owner_id=excluded.owner_id AND relay.connections.provider_id=excluded.provider_id AND relay.connections.provider_version=excluded.provider_version AND relay.connections.name=excluded.name RETURNING *", &[&id,&owner,&provider,&version,&name]).await?;
        tx.commit().await?;
        Connection::from_row(row)
    }
    pub async fn connection(&self, id: Uuid) -> Result<Connection> {
        Connection::from_row(
            self.pool
                .get()
                .await?
                .query_opt("SELECT * FROM relay.connections WHERE id=$1", &[&id])
                .await?
                .context("connection unavailable")?,
        )
    }
    pub async fn list(&self, owner: &str) -> Result<Vec<Connection>> {
        self.pool.get().await?.query("SELECT * FROM relay.connections WHERE owner_id=$1 ORDER BY (status='disconnected'),created_at DESC,id LIMIT 256", &[&owner]).await?.into_iter().map(Connection::from_row).collect()
    }
    pub async fn save_credentials(
        &self,
        before: &Connection,
        envelope: &Envelope,
        scopes: &[String],
        expiry: Option<DateTime<Utc>>,
    ) -> Result<()> {
        let count = self.pool.get().await?.execute("UPDATE relay.connections SET credential=$1,scopes=$2,expires_at=$3,status='connected',version=version+1,refresh_started_at=NULL,updated_at=clock_timestamp() WHERE id=$4 AND version=$5 AND status<>'disconnected'", &[&serde_json::to_value(envelope)?,&scopes,&expiry,&before.id,&before.version]).await?;
        ensure!(
            count == 1,
            "connection changed before credentials could be committed"
        );
        Ok(())
    }
    pub async fn disconnect(&self, id: Uuid, owner: &str, revoke: bool) -> Result<()> {
        let mut client = self.pool.get().await?;
        let tx = client.transaction().await?;
        tx.execute("INSERT INTO relay.agent_cleanups(connection_id,workspace_uid) SELECT b.connection_id,b.workspace_uid FROM relay.workspace_bindings b JOIN relay.connections c ON c.id=b.connection_id WHERE b.connection_id=$1 AND c.owner_id=$2 ON CONFLICT DO NOTHING", &[&id,&owner]).await?;
        if revoke {
            tx.execute("INSERT INTO relay.revocations(connection_id,credential) SELECT id,credential FROM relay.connections WHERE id=$1 AND owner_id=$2 AND credential IS NOT NULL", &[&id,&owner]).await?;
        }
        let count=tx.execute("UPDATE relay.connections SET status='disconnected',credential=NULL,expires_at=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND owner_id=$2", &[&id,&owner]).await?;
        ensure!(count == 1, "connection unavailable");
        tx.execute(
            "DELETE FROM relay.oauth_attempts WHERE connection_id=$1",
            &[&id],
        )
        .await?;
        tx.execute(
            "DELETE FROM relay.workspace_bindings WHERE connection_id=$1",
            &[&id],
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }
    /// Claim once with a durable marker before contacting a rotating-token provider.
    pub async fn claim_refresh(&self, connection: &Connection) -> Result<bool> {
        Ok(self.pool.get().await?.execute("UPDATE relay.connections SET status='refreshing',version=version+1,refresh_started_at=clock_timestamp() WHERE id=$1 AND version=$2 AND status='connected'", &[&connection.id,&connection.version]).await?==1)
    }
    pub async fn refresh_failed(&self, id: Uuid, version: i64) -> Result<()> {
        self.pool.get().await?.execute("UPDATE relay.connections SET status='reconnect',version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND version=$2 AND status='refreshing'", &[&id,&version]).await?;
        Ok(())
    }
    pub async fn expire_uncertain_refreshes(&self) -> Result<()> {
        self.pool.get().await?.execute("UPDATE relay.connections SET status='reconnect',version=version+1 WHERE status='refreshing' AND refresh_started_at < clock_timestamp()-interval '60 seconds'", &[]).await?;
        Ok(())
    }
}

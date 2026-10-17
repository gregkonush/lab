use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use http::Uri;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tonic::Status;
use uuid::Uuid;

use crate::{
    auth::Principal,
    control::{Database, sql_error},
    guest::{BROWSER_PORT, EDITOR_PORT},
    ofz::{self, proto::Action},
};

const TICKET_LIFETIME_MS: i64 = 30_000;
const PREVIEW_LIFETIME_MS: i64 = 30 * 60 * 1000;
const TICKET_LIMIT: i32 = 128;
const PREVIEW_LIMIT: i32 = 96;
const PER_WORKSPACE_LIMIT: i32 = 16;

#[derive(Clone, Copy)]
enum CapabilityTable {
    Tickets,
    Previews,
}

impl CapabilityTable {
    fn name(self) -> &'static str {
        match self {
            Self::Tickets => "tengri.tickets",
            Self::Previews => "tengri.previews",
        }
    }

    async fn allocate(
        self,
        tx: &tokio_postgres::Transaction<'_>,
        workspace: Uuid,
    ) -> Result<(i16, i16), Status> {
        let table = self.name();
        tx.batch_execute(&format!(
            "DELETE FROM {table} WHERE ctid IN (SELECT ctid FROM {table} WHERE expires_at_ms<=tengri.now_ms() FOR UPDATE SKIP LOCKED)"
        )).await.map_err(sql_error)?;
        let workspace_slot = self
            .reserve_slot(tx, Some(workspace), PER_WORKSPACE_LIMIT)
            .await?;
        let limit = match self {
            Self::Tickets => TICKET_LIMIT,
            Self::Previews => PREVIEW_LIMIT,
        };
        let capacity_slot = self.reserve_slot(tx, None, limit).await?;
        Ok((capacity_slot, workspace_slot))
    }

    async fn reserve_slot(
        self,
        tx: &tokio_postgres::Transaction<'_>,
        workspace: Option<Uuid>,
        limit: i32,
    ) -> Result<i16, Status> {
        let table = self.name();
        let column = if workspace.is_some() {
            "workspace_slot"
        } else {
            "capacity_slot"
        };
        let candidates = tx.query(&format!(
            "SELECT slot::smallint FROM generate_series(1,$1::integer) slot WHERE NOT EXISTS (SELECT 1 FROM {table} WHERE {column}=slot AND ($2::uuid IS NULL OR workspace_uid=$2)) ORDER BY slot"
        ), &[&limit, &workspace]).await.map_err(sql_error)?;
        for candidate in candidates {
            let slot: i16 = candidate.get(0);
            let mut hash = Sha256::new();
            hash.update(b"tengri-capability-slot\0");
            hash.update(table.as_bytes());
            hash.update([u8::from(workspace.is_some())]);
            hash.update(workspace.unwrap_or_else(Uuid::nil).as_bytes());
            hash.update(slot.to_be_bytes());
            let key = i64::from_be_bytes(hash.finalize()[..8].try_into().unwrap());
            let locked: bool = tx
                .query_one("SELECT pg_try_advisory_xact_lock($1)", &[&key])
                .await
                .map_err(sql_error)?
                .get(0);
            if !locked {
                continue;
            }
            // A previous holder may have committed after the candidate scan. Read a new snapshot.
            let free: bool = tx.query_one(&format!(
                "SELECT NOT EXISTS (SELECT 1 FROM {table} WHERE {column}=$1 AND ($2::uuid IS NULL OR workspace_uid=$2))"
            ), &[&slot, &workspace]).await.map_err(sql_error)?.get(0);
            if free {
                return Ok(slot);
            }
        }
        Err(Status::resource_exhausted("capability capacity exhausted"))
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum TicketScope {
    Terminal {
        terminal_id: String,
    },
    Preview {
        incarnation: String,
        session_id: String,
        port: u16,
        initial_path: String,
        initial_fragment: String,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TicketRecord {
    pub principal: Principal,
    pub agent_id: String,
    pub scope: TicketScope,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewSessionRecord {
    pub incarnation: String,
    pub id: String,
    // Plaintext exists only in the response or the currently presented credential.
    #[serde(skip)]
    pub token: String,
    pub principal: Principal,
    pub agent_id: String,
    pub port: u16,
    pub initial_path: String,
    pub initial_fragment: String,
    pub expires_at: SystemTime,
}

#[derive(Clone)]
pub struct TicketStore {
    public_url: Arc<str>,
    database: Arc<Database>,
}

#[derive(Debug)]
pub struct IssuedTicket {
    pub id: String,
    pub token: String,
    pub url: String,
    pub expires_at: String,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct TicketStats {
    pub pending: usize,
    pub previews: usize,
}

impl TicketStore {
    pub fn new(public_url: String, database: Arc<Database>) -> anyhow::Result<Self> {
        let public_url = public_url.trim_end_matches('/');
        validate_public_url(public_url)?;
        Ok(Self {
            public_url: public_url.to_owned().into(),
            database,
        })
    }

    pub async fn issue_terminal(
        &self,
        principal: &Principal,
        agent_id: &str,
        terminal_id: &str,
    ) -> Result<IssuedTicket, Status> {
        let mut issued = self
            .issue(
                principal,
                agent_id,
                TicketScope::Terminal {
                    terminal_id: terminal_id.into(),
                },
                "/v1/terminal/ws",
                false,
            )
            .await?;
        issued.url = websocket_url(&issued.url)?;
        Ok(issued)
    }

    pub async fn issue_preview(
        &self,
        principal: &Principal,
        agent_id: &str,
        port: u16,
        initial_path: &str,
        initial_fragment: &str,
    ) -> Result<IssuedTicket, Status> {
        let id = dns_id(random_token().as_bytes());
        self.preview(
            principal,
            agent_id,
            id,
            port,
            initial_path,
            initial_fragment,
        )
        .await
    }

    pub async fn issue_editor(
        &self,
        principal: &Principal,
        agent_id: &str,
        window_id: &str,
    ) -> Result<IssuedTicket, Status> {
        let context = &principal.context;
        let identity = format!(
            "{}\0{}\0{}\0{}\0{}\0{window_id}",
            principal.owner_hash,
            context.session_id,
            context.workspace_uid,
            context.runtime_epoch,
            context.origin
        );
        self.preview(
            principal,
            agent_id,
            dns_id(identity.as_bytes()),
            EDITOR_PORT,
            "/_tengri/editor/open",
            "",
        )
        .await
    }

    async fn preview(
        &self,
        principal: &Principal,
        agent_id: &str,
        id: String,
        port: u16,
        initial_path: &str,
        initial_fragment: &str,
    ) -> Result<IssuedTicket, Status> {
        let mut issued = self
            .issue(
                principal,
                agent_id,
                TicketScope::Preview {
                    incarnation: principal.context.workspace_uid.clone(),
                    session_id: id.clone(),
                    port,
                    initial_path: initial_path.into(),
                    initial_fragment: initial_fragment.into(),
                },
                "/v1/preview/open",
                true,
            )
            .await?;
        issued.id = id;
        Ok(issued)
    }

    #[tracing::instrument(name = "db.tickets.issue", skip_all)]
    async fn issue(
        &self,
        principal: &Principal,
        agent_id: &str,
        scope: TicketScope,
        path: &str,
        fragment: bool,
    ) -> Result<IssuedTicket, Status> {
        let (uid, session) = bindings(principal)?;
        let expected = match &scope {
            TicketScope::Terminal { terminal_id }
                if !terminal_id.is_empty() && terminal_id.len() <= 128 =>
            {
                Action::TerminalControl
            }
            TicketScope::Preview {
                port: EDITOR_PORT, ..
            } => Action::EditorOpen,
            TicketScope::Preview {
                port: BROWSER_PORT, ..
            } => Action::BrowserControl,
            TicketScope::Preview { port: 1.., .. } => Action::PreviewAccess,
            _ => return Err(Status::invalid_argument("invalid capability scope")),
        };
        if principal.action != expected || agent_id.is_empty() || agent_id.len() > 253 {
            return Err(Status::permission_denied(
                "capability action binding rejected",
            ));
        }
        let token = random_token();
        let payload = serde_json::to_value(TicketRecord {
            principal: principal.clone(),
            agent_id: agent_id.into(),
            scope,
        })
        .map_err(|_| Status::internal("capability encoding failed"))?;
        let mut client = self.database.connection().await?;
        let tx = client.transaction().await.map_err(sql_error)?;
        let (capacity_slot, workspace_slot) = CapabilityTable::Tickets.allocate(&tx, uid).await?;
        let expiry: i64 = tx.query_one("INSERT INTO tengri.tickets(token_hash,agent_id,workspace_uid,session_id,payload,expires_at_ms,capacity_slot,workspace_slot) VALUES($1,$2,$3,$4,$5,tengri.now_ms()+$6,$7,$8) RETURNING expires_at_ms",
            &[&token_hash(&token)?, &agent_id, &uid, &session, &payload, &TICKET_LIFETIME_MS, &capacity_slot, &workspace_slot]).await.map_err(sql_error)?.get(0);
        tx.commit().await.map_err(sql_error)?;
        Ok(IssuedTicket {
            id: token.clone(),
            url: if fragment {
                format!("{}{path}#{token}", self.public_url)
            } else {
                format!("{}{path}", self.public_url)
            },
            token,
            expires_at: DateTime::<Utc>::from_timestamp_millis(expiry)
                .ok_or_else(|| Status::internal("invalid capability deadline"))?
                .to_rfc3339(),
        })
    }

    pub async fn consume(&self, token: &str) -> Result<TicketRecord, Status> {
        let client = self.database.connection().await?;
        let row = client.query_opt("DELETE FROM tengri.tickets WHERE token_hash=$1 AND expires_at_ms>tengri.now_ms() RETURNING payload", &[&token_hash(token)?])
            .await.map_err(sql_error)?.ok_or_else(invalid_capability)?;
        let mut record: TicketRecord = decode(row.get(0))?;
        if !matches!(record.scope, TicketScope::Terminal { .. }) {
            return Err(Status::permission_denied("terminal capability required"));
        }
        bindings(&record.principal)?;
        // The SQL capability lifetime is independent of the original BFF submission deadline.
        // Redemption still requires a new Ofz check of this exact session and runtime binding.
        record.principal.context.deadline_unix_ms = ofz::now_ms()? + ofz::AUDITED_REQUEST_BUDGET_MS;
        Ok(record)
    }

    #[tracing::instrument(name = "db.previews.redeem", skip_all)]
    pub async fn consume_preview(&self, token: &str) -> Result<PreviewSessionRecord, Status> {
        let hash = token_hash(token)?;
        let mut client = self.database.connection().await?;
        let tx = client.transaction().await.map_err(sql_error)?;
        let row = tx.query_opt("DELETE FROM tengri.tickets WHERE token_hash=$1 AND expires_at_ms>tengri.now_ms() RETURNING payload", &[&hash])
            .await.map_err(sql_error)?.ok_or_else(invalid_capability)?;
        let ticket: TicketRecord = decode(row.get(0))?;
        let (uid, session_id) = bindings(&ticket.principal)?;
        let TicketScope::Preview {
            incarnation,
            session_id: id,
            port,
            initial_path,
            initial_fragment,
        } = ticket.scope
        else {
            return Err(Status::permission_denied("preview capability required"));
        };
        let existing = tx.query_opt("SELECT capacity_slot,workspace_slot FROM tengri.previews WHERE id=$1 AND workspace_uid=$2 FOR UPDATE", &[&id, &uid]).await.map_err(sql_error)?;
        let (capacity_slot, workspace_slot) = match existing {
            Some(row) => (row.get::<_, i16>(0), row.get::<_, i16>(1)),
            None => CapabilityTable::Previews.allocate(&tx, uid).await?,
        };
        let expiry: i64 = tx
            .query_one("SELECT tengri.now_ms()+$1", &[&PREVIEW_LIFETIME_MS])
            .await
            .map_err(sql_error)?
            .get(0);
        let mut session = PreviewSessionRecord {
            incarnation,
            id,
            token: random_token(),
            principal: ticket.principal,
            agent_id: ticket.agent_id,
            port,
            initial_path,
            initial_fragment,
            expires_at: UNIX_EPOCH + Duration::from_millis(expiry as u64),
        };
        let payload = serde_json::to_value(&session)
            .map_err(|_| Status::internal("capability encoding failed"))?;
        let changed = tx.execute("INSERT INTO tengri.previews(id,token_hash,revocation_hash,agent_id,workspace_uid,session_id,payload,expires_at_ms,capacity_slot,workspace_slot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,revocation_hash=excluded.revocation_hash,agent_id=excluded.agent_id,session_id=excluded.session_id,payload=excluded.payload,expires_at_ms=excluded.expires_at_ms WHERE tengri.previews.workspace_uid=excluded.workspace_uid",
            &[&session.id,&token_hash(&session.token)?,&hash,&session.agent_id,&uid,&session_id,&payload,&expiry,&capacity_slot,&workspace_slot]).await.map_err(sql_error)?;
        if changed != 1 {
            return Err(Status::permission_denied(
                "preview workspace binding rejected",
            ));
        }
        tx.commit().await.map_err(sql_error)?;
        session.principal.context.deadline_unix_ms =
            ofz::now_ms()? + ofz::AUDITED_REQUEST_BUDGET_MS;
        Ok(session)
    }

    pub async fn preview_session(
        &self,
        id: &str,
        token: &str,
    ) -> Result<PreviewSessionRecord, Status> {
        let client = self.database.connection().await?;
        let row = client.query_opt("SELECT payload FROM tengri.previews WHERE id=$1 AND token_hash=$2 AND expires_at_ms>tengri.now_ms()", &[&id,&token_hash(token)?])
            .await.map_err(sql_error)?.ok_or_else(invalid_capability)?;
        let mut session: PreviewSessionRecord = decode(row.get(0))?;
        bindings(&session.principal)?;
        session.principal.context.deadline_unix_ms =
            ofz::now_ms()? + ofz::AUDITED_REQUEST_BUDGET_MS;
        session.token = token.into();
        Ok(session)
    }

    pub async fn revoke_preview_lease(
        &self,
        principal: &Principal,
        agent_id: &str,
        id: &str,
        token: &str,
    ) -> Result<(), Status> {
        let (uid, session) = bindings(principal)?;
        let hash = token_hash(token)?;
        let mut client = self.database.connection().await?;
        let tx = client.transaction().await.map_err(sql_error)?;
        tx.execute("DELETE FROM tengri.tickets WHERE token_hash=$1 AND workspace_uid=$2 AND session_id=$3 AND agent_id=$4 AND payload->'scope'->>'session_id'=$5 AND payload->'principal'->>'owner_hash'=$6",
            &[&hash,&uid,&session,&agent_id,&id,&principal.owner_hash]).await.map_err(sql_error)?;
        tx.execute("DELETE FROM tengri.previews WHERE id=$1 AND revocation_hash=$2 AND workspace_uid=$3 AND session_id=$4 AND agent_id=$5 AND payload->'principal'->>'owner_hash'=$6",
            &[&id,&hash,&uid,&session,&agent_id,&principal.owner_hash]).await.map_err(sql_error)?;
        tx.commit().await.map_err(sql_error)?;
        Ok(())
    }

    pub async fn revoke_desktop_previews(&self, principal: &Principal) -> Result<(), Status> {
        let session = Uuid::parse_str(&principal.context.session_id)
            .map_err(|_| Status::unauthenticated("session required"))?;
        let mut client = self.database.connection().await?;
        let tx = client.transaction().await.map_err(sql_error)?;
        tx.execute("DELETE FROM tengri.tickets WHERE session_id=$1 AND payload->'principal'->>'owner_hash'=$2 AND (payload->'scope'->>'port')::integer IN ($3,$4)",
            &[&session,&principal.owner_hash,&(EDITOR_PORT as i32),&(BROWSER_PORT as i32)]).await.map_err(sql_error)?;
        tx.execute("DELETE FROM tengri.previews WHERE session_id=$1 AND payload->'principal'->>'owner_hash'=$2 AND (payload->>'port')::integer IN ($3,$4)",
            &[&session,&principal.owner_hash,&(EDITOR_PORT as i32),&(BROWSER_PORT as i32)]).await.map_err(sql_error)?;
        tx.commit().await.map_err(sql_error)?;
        Ok(())
    }

    pub async fn remove_agent(&self, workspace_uid: &str) -> Result<(), Status> {
        let uid = Uuid::parse_str(workspace_uid)
            .map_err(|_| Status::invalid_argument("workspace UID required"))?;
        let mut client = self.database.connection().await?;
        let tx = client.transaction().await.map_err(sql_error)?;
        tx.execute("DELETE FROM tengri.tickets WHERE workspace_uid=$1", &[&uid])
            .await
            .map_err(sql_error)?;
        tx.execute(
            "DELETE FROM tengri.previews WHERE workspace_uid=$1",
            &[&uid],
        )
        .await
        .map_err(sql_error)?;
        tx.commit().await.map_err(sql_error)?;
        Ok(())
    }

    pub async fn stats(&self) -> Result<TicketStats, Status> {
        let client = self.database.connection().await?;
        let row = client.query_one("SELECT (SELECT count(*) FROM tengri.tickets WHERE expires_at_ms>tengri.now_ms()),(SELECT count(*) FROM tengri.previews WHERE expires_at_ms>tengri.now_ms())", &[]).await.map_err(sql_error)?;
        Ok(TicketStats {
            pending: row.get::<_, i64>(0) as usize,
            previews: row.get::<_, i64>(1) as usize,
        })
    }
}

fn bindings(principal: &Principal) -> Result<(Uuid, Uuid), Status> {
    let context = &principal.context;
    if !ofz::canonical_human(&principal.owner_hash)
        || !matches!(context.actor.as_ref().and_then(|a| a.identity.as_ref()), Some(ofz::proto::actor::Identity::HumanId(human)) if human == &principal.owner_hash)
        || !ofz::canonical_uuid(&context.workspace_uid)
        || !ofz::canonical_uuid(&context.runtime_epoch)
        || !ofz::canonical_uuid(&context.session_id)
        || principal.recovery_generation == 0
        || context.contract_version != 1
    {
        return Err(Status::unauthenticated(
            "complete capability identity and runtime binding required",
        ));
    }
    Ok((
        Uuid::parse_str(&context.workspace_uid).unwrap(),
        Uuid::parse_str(&context.session_id).unwrap(),
    ))
}

fn decode<T: serde::de::DeserializeOwned>(value: serde_json::Value) -> Result<T, Status> {
    serde_json::from_value(value).map_err(|_| Status::unavailable("stored capability is invalid"))
}

fn random_token() -> String {
    let mut bytes = [0_u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    URL_SAFE_NO_PAD.encode(bytes)
}

fn token_hash(token: &str) -> Result<Vec<u8>, Status> {
    if token.len() != 43
        || URL_SAFE_NO_PAD
            .decode(token)
            .ok()
            .is_none_or(|bytes| bytes.len() != 32 || URL_SAFE_NO_PAD.encode(bytes) != token)
    {
        return Err(invalid_capability());
    }
    Ok(Sha256::digest(token.as_bytes()).to_vec())
}

fn dns_id(value: &[u8]) -> String {
    format!("{:x}", Sha256::digest(value))[..24].into()
}
fn invalid_capability() -> Status {
    Status::unauthenticated("capability is invalid, expired or already used")
}

fn websocket_url(public_url: &str) -> Result<String, Status> {
    let uri = public_url
        .parse::<Uri>()
        .map_err(|_| Status::internal("terminal WebSocket URL is invalid"))?;
    match uri.scheme_str() {
        Some("https") => Ok(public_url.replacen("https://", "wss://", 1)),
        Some("http") if uri.host() == Some("localhost") => {
            Ok(public_url.replacen("http://", "ws://", 1))
        }
        _ => Err(Status::internal("terminal WebSocket URL is invalid")),
    }
}

fn validate_public_url(public_url: &str) -> anyhow::Result<()> {
    let uri = public_url
        .parse::<Uri>()
        .map_err(|error| anyhow::anyhow!("TENGRI_PUBLIC_URL is invalid: {error}"))?;
    anyhow::ensure!(
        uri.authority().is_some() && uri.host().is_some(),
        "TENGRI_PUBLIC_URL must be an absolute URL"
    );
    anyhow::ensure!(
        uri.path() == "/" && uri.query().is_none(),
        "TENGRI_PUBLIC_URL must not include a path or query"
    );
    anyhow::ensure!(
        uri.scheme_str() == Some("https")
            || (uri.scheme_str() == Some("http") && uri.host() == Some("localhost")),
        "TENGRI_PUBLIC_URL must use HTTPS outside localhost"
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "requires disposable shared TLS PostgreSQL from test-runtime.sh"]
    async fn runtime_shared_state_pending_reservations_do_not_block_other_slots() {
        let database = Arc::new(Database::shared_fixture().await);
        let store =
            TicketStore::new("https://tengri.proompteng.ai".into(), database.clone()).unwrap();
        let mut client = database.connection().await.unwrap();
        client
            .batch_execute("DELETE FROM tengri.tickets; DELETE FROM tengri.previews")
            .await
            .unwrap();
        let owner = Principal::fixture(
            &"a".repeat(64),
            &Uuid::new_v4().to_string(),
            Action::EditorOpen,
        );
        let uid = Uuid::parse_str(&owner.context.workspace_uid).unwrap();
        let tx = client.transaction().await.unwrap();
        let reserved_ticket = CapabilityTable::Tickets.allocate(&tx, uid).await.unwrap();
        let reserved_preview = CapabilityTable::Previews.allocate(&tx, uid).await.unwrap();
        let started = tokio::time::Instant::now();
        let outcome = async {
            let ticket = tokio::time::timeout(
                Duration::from_secs(2),
                store.issue_editor(&owner, "agent", "code"),
            )
            .await
            .map_err(|_| {
                Status::deadline_exceeded("ticket allocation waited for another reservation")
            })??;
            let reader = database.connection().await?;
            let row = reader
                .query_one(
                    "SELECT capacity_slot,workspace_slot FROM tengri.tickets",
                    &[],
                )
                .await
                .map_err(sql_error)?;
            assert_ne!(reserved_ticket.0, row.get::<_, i16>(0));
            assert_ne!(reserved_ticket.1, row.get::<_, i16>(1));
            let preview =
                tokio::time::timeout(Duration::from_secs(2), store.consume_preview(&ticket.token))
                    .await
                    .map_err(|_| {
                        Status::deadline_exceeded(
                            "preview allocation waited for another reservation",
                        )
                    })??;
            let row = reader
                .query_one(
                    "SELECT capacity_slot,workspace_slot FROM tengri.previews WHERE id=$1",
                    &[&preview.id],
                )
                .await
                .map_err(sql_error)?;
            assert_ne!(reserved_preview.0, row.get::<_, i16>(0));
            assert_ne!(reserved_preview.1, row.get::<_, i16>(1));
            Ok::<_, Status>(())
        }
        .await;
        eprintln!(
            "independent ticket and preview round trip completed in {:?}",
            started.elapsed()
        );
        tx.rollback().await.unwrap();
        assert!(
            matches!(outcome, Ok(())),
            "independent reservations must proceed before another commit: {outcome:?}"
        );
    }
}

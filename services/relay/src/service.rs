use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use prost::Message;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, sync::Arc, time::Duration};
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::{
    authz_proto::{self as proto, Action, RequestContext, ResourceKind, actor::Identity},
    catalog::{self, Catalog},
    crypto::Vault,
    network::Network,
    oauth::{self, Credential},
    policy::{self, Policy},
    store::{Connection, Store},
    upstream,
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub context: Option<String>,
    pub command: Command,
}
#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    Providers,
    List {
        workspace: Option<Uuid>,
    },
    Create {
        id: Uuid,
        provider: String,
        name: String,
    },
    ConnectToken {
        id: Uuid,
        version: i64,
        token: String,
    },
    OAuthStart {
        id: Uuid,
    },
    OAuthFinish {
        state: String,
        code: String,
    },
    ConnectClient {
        id: Uuid,
    },
    Bind {
        id: Uuid,
        workspace: Uuid,
        operations: Vec<String>,
        constraints: BTreeMap<String, Vec<Value>>,
    },
    Disconnect {
        id: Uuid,
    },
    AckCleanup {
        id: Uuid,
        workspace: Uuid,
    },
    StageGrant {
        id: Uuid,
        workspace: Uuid,
        grant_id: Uuid,
        expires_at: chrono::DateTime<chrono::Utc>,
    },
    SetGrantStatus {
        grant_id: Uuid,
        status: GrantStatus,
    },
    Invoke {
        id: Uuid,
        workspace: Uuid,
        operation: String,
        arguments: Value,
    },
    AgentInvoke {
        grant_id: String,
        credential: String,
        proof: String,
        body: String,
    },
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum GrantStatus {
    Active,
    Cancelled,
    Revoked,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AgentCall {
    connection_id: Uuid,
    operation: String,
    arguments: Value,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicProvider<'a> {
    id: &'a str,
    name: &'a str,
    version: &'a str,
    authentication: &'static str,
    operations: Vec<PublicOperation<'a>>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublicOperation<'a> {
    name: &'a str,
    description: &'a str,
    read_only: bool,
    input_schema: &'a Value,
}

pub struct Service {
    pub store: Store,
    pub vault: Vault,
    pub network: Network,
    pub catalog: Catalog,
    pub policy: Arc<dyn Policy>,
    pub callback: String,
    capacity: Arc<Semaphore>,
    principals: Mutex<BTreeMap<String, Arc<Semaphore>>>,
}

impl Service {
    pub async fn maintain(&self) -> Result<()> {
        self.store.pool.get().await?.execute("UPDATE relay.grant_installations SET status='cancelled' WHERE status='pending' AND revoke_after<=clock_timestamp()", &[]).await?;
        self.store.pool.get().await?.execute("DELETE FROM relay.grant_installations WHERE expires_at<clock_timestamp()-interval '5 minutes'", &[]).await?;
        self.store.expire_uncertain_refreshes().await?;
        self.store.pool.get().await?.execute("UPDATE relay.invocations SET outcome='unknown',completed_at=clock_timestamp() WHERE outcome='started' AND started_at<clock_timestamp()-interval '2 minutes'", &[]).await?;
        self.store
            .pool
            .get()
            .await?
            .execute(
                "DELETE FROM relay.oauth_attempts WHERE expires_at<clock_timestamp()",
                &[],
            )
            .await?;
        for _ in 0..16 {
            let row=self.store.pool.get().await?.query_opt("UPDATE relay.revocations SET attempts=attempts+1,next_attempt_at=clock_timestamp()+interval '60 seconds' WHERE id=(SELECT id FROM relay.revocations WHERE status='pending' AND next_attempt_at<=clock_timestamp() ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING connection_id,credential,id", &[]).await?;
            let Some(row) = row else {
                break;
            };
            let id: Uuid = row.get(0);
            let envelope = serde_json::from_value(row.get(1))?;
            let connection = self.store.connection(id).await?;
            let result = async {
                let raw = self.vault.decrypt(
                    id,
                    &connection.owner_id,
                    &connection.provider_id,
                    &envelope,
                )?;
                let credential: Credential = serde_json::from_slice(&raw)?;
                oauth::revoke(&self.network, &credential).await
            }
            .await;
            if result.is_ok() {
                self.store
                    .pool
                    .get()
                    .await?
                    .execute(
                        "DELETE FROM relay.revocations WHERE id=$1",
                        &[&row.get::<_, Uuid>(2)],
                    )
                    .await?;
            } else {
                tracing::warn!(connection_id=%id,"provider revocation remains pending");
            }
        }
        Ok(())
    }
    pub fn new(
        store: Store,
        vault: Vault,
        catalog: Catalog,
        policy: Arc<dyn Policy>,
        callback: String,
    ) -> Self {
        Self {
            store,
            vault,
            catalog,
            policy,
            callback,
            network: Network::default(),
            capacity: Arc::new(Semaphore::new(64)),
            principals: Mutex::new(BTreeMap::new()),
        }
    }
    fn context(raw: Option<&str>) -> Result<RequestContext> {
        let raw = STANDARD
            .decode(raw.context("authenticated context required")?)
            .context("invalid context encoding")?;
        ensure!(raw.len() <= 16384, "context too large");
        let context = RequestContext::decode(raw.as_slice()).context("invalid context")?;
        ensure!(
            context.contract_version == 1
                && context.deadline_unix_ms > policy::now_ms()
                && context.deadline_unix_ms <= policy::now_ms() + 25000
                && context.grant_id.is_empty()
                && !context.session_id.is_empty(),
            "invalid human context"
        );
        let _ = Self::owner(&context)?;
        Ok(context)
    }
    fn owner(context: &RequestContext) -> Result<&str> {
        let Some(Identity::HumanId(owner)) = context
            .actor
            .as_ref()
            .and_then(|actor| actor.identity.as_ref())
        else {
            anyhow::bail!("human session required");
        };
        ensure!(
            owner.len() == 64
                && owner
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()),
            "invalid human identity"
        );
        Ok(owner)
    }
    async fn connection(&self, context: &RequestContext, id: Uuid) -> Result<Connection> {
        let connection = self.store.connection(id).await?;
        ensure!(
            connection.owner_id == Self::owner(context)?,
            "connection unavailable"
        );
        self.policy
            .check(
                context,
                Action::ConnectorManage,
                ResourceKind::ConnectorConnection,
                &id.to_string(),
                "",
                "",
            )
            .await?;
        Ok(connection)
    }
    pub async fn handle(&self, input: Input) -> Result<Value> {
        let _global = self
            .capacity
            .clone()
            .try_acquire_owned()
            .context("Relay is busy")?;
        if let Command::AgentInvoke {
            grant_id,
            credential,
            proof,
            body,
        } = input.command
        {
            let grant_uuid = Uuid::parse_str(&grant_id)?;
            if let Some(row) = self
                .store
                .pool
                .get()
                .await?
                .query_opt(
                    "SELECT status FROM relay.grant_installations WHERE grant_id=$1",
                    &[&grant_uuid],
                )
                .await?
            {
                ensure!(
                    row.get::<_, String>(0) == "active",
                    "connector installation is not confirmed"
                );
            }
            let binding = STANDARD.decode(body).context("invalid agent body")?;
            ensure!(binding.len() <= 1024 * 1024, "agent request too large");
            let AgentCall {
                connection_id: id,
                operation,
                arguments,
            } = serde_json::from_slice(&binding).context("invalid agent request")?;
            let connection = self.store.connection(id).await?;
            let operation_spec =
                self.catalog
                    .operation(&connection.provider_id, &operation, &arguments)?;
            let action = if operation_spec.read_only {
                Action::ConnectorRead
            } else {
                Action::ConnectorInvoke
            };
            let authorized = self
                .policy
                .agent(proto::CheckConnectorAgentRequest {
                    grant_id,
                    credential,
                    proof,
                    request_hash: Sha256::digest(binding).to_vec(),
                    connection_id: id.to_string(),
                    operation: operation.clone(),
                    action: action as i32,
                })
                .await?;
            let context = authorized.context.context("agent context missing")?;
            let uid = Uuid::parse_str(&context.workspace_uid)?;
            return self
                .invoke(
                    &context,
                    id,
                    uid,
                    &operation,
                    arguments,
                    authorized.decision,
                )
                .await;
        }
        let mut context = Self::context(input.context.as_deref())?;
        match &input.command {
            Command::List {
                workspace: Some(workspace),
            }
            | Command::Bind { workspace, .. }
            | Command::StageGrant { workspace, .. }
            | Command::Invoke { workspace, .. } => context.workspace_uid = workspace.to_string(),
            _ => {}
        }
        let owner = Self::owner(&context)?;
        self.policy
            .check(
                &context,
                Action::PlatformAdmit,
                ResourceKind::Platform,
                "lab",
                "",
                "",
            )
            .await?;
        match input.command {
            Command::Providers => {
                let providers = self
                    .catalog
                    .providers()
                    .map(|provider| PublicProvider {
                        id: &provider.id,
                        name: &provider.name,
                        version: &provider.version,
                        authentication: match &provider.authentication {
                            catalog::Authentication::None => "none",
                            catalog::Authentication::Bearer => "bearer",
                            catalog::Authentication::ApiKey { .. } => "apiKey",
                            catalog::Authentication::OAuth2 {
                                grant: catalog::OAuthGrant::AuthorizationCode,
                                ..
                            } => "oauth2",
                            catalog::Authentication::OAuth2 {
                                grant: catalog::OAuthGrant::ClientCredentials,
                                ..
                            } => "clientCredentials",
                        },
                        operations: provider
                            .operations
                            .iter()
                            .map(|(name, op)| PublicOperation {
                                name,
                                description: &op.description,
                                read_only: op.read_only,
                                input_schema: &op.input_schema,
                            })
                            .collect(),
                    })
                    .collect::<Vec<_>>();
                Ok(json!({"providers":providers}))
            }
            Command::List { workspace } => {
                let mut bindings = Vec::new();
                if let Some(workspace) = workspace {
                    self.policy
                        .check(
                            &context,
                            Action::WorkspacePolicyRead,
                            ResourceKind::Workspace,
                            &workspace.to_string(),
                            "",
                            "",
                        )
                        .await?;
                }
                for row in self.store.pool.get().await?.query("SELECT b.connection_id,b.operations,b.constraints,b.workspace_uid FROM relay.workspace_bindings b JOIN relay.connections c ON c.id=b.connection_id WHERE c.owner_id=$1 AND ($2::uuid IS NULL OR b.workspace_uid=$2) LIMIT 768", &[&owner,&workspace]).await? {
                    bindings.push(json!({"connectionId":row.get::<_,Uuid>(0),"operations":row.get::<_,Vec<String>>(1),"constraints":row.get::<_,Value>(2),"workspaceUid":row.get::<_,Uuid>(3)}));
                }
                let cleanups=self.store.pool.get().await?.query("SELECT a.connection_id,a.workspace_uid FROM relay.agent_cleanups a JOIN relay.connections c ON c.id=a.connection_id WHERE c.owner_id=$1 ORDER BY a.connection_id,a.workspace_uid LIMIT 128", &[&owner]).await?.into_iter().map(|row|json!({"connectionId":row.get::<_,Uuid>(0),"workspaceUid":row.get::<_,Uuid>(1)})).collect::<Vec<_>>();
                let grant_cleanups=self.store.pool.get().await?.query("SELECT g.grant_id,g.workspace_uid FROM relay.grant_installations g JOIN relay.connections c ON c.id=g.connection_id WHERE c.owner_id=$1 AND (g.status='cancelled' OR (g.status='pending' AND g.revoke_after<=clock_timestamp())) AND g.expires_at>clock_timestamp() ORDER BY g.grant_id LIMIT 128", &[&owner]).await?.into_iter().map(|row|json!({"grantId":row.get::<_,Uuid>(0),"workspaceUid":row.get::<_,Uuid>(1)})).collect::<Vec<_>>();
                Ok(
                    json!({"connections":self.store.list(owner).await?,"bindings":bindings,"cleanups":cleanups,"grantCleanups":grant_cleanups}),
                )
            }
            Command::Create { id, provider, name } => {
                let provider = self.catalog.provider(&provider)?;
                self.policy
                    .check(
                        &context,
                        Action::ConnectorManage,
                        ResourceKind::ConnectorConnection,
                        &id.to_string(),
                        "",
                        "",
                    )
                    .await?;
                let connection = self
                    .store
                    .create(id, owner, &provider.id, &provider.version, &name)
                    .await?;
                if matches!(provider.authentication, catalog::Authentication::None)
                    && connection.status == "pending"
                {
                    let envelope = self.vault.encrypt(
                        id,
                        owner,
                        &provider.id,
                        b"{\"accessToken\":\"\",\"refreshToken\":null}",
                    )?;
                    self.store
                        .save_credentials(&connection, &envelope, &[], None)
                        .await?;
                }
                Ok(json!({"connection":self.store.connection(id).await?}))
            }
            Command::ConnectToken { id, version, token } => {
                let token = Zeroizing::new(token);
                ensure!(oauth::valid_token(&token), "invalid provider token");
                let connection = self.connection(&context, id).await?;
                ensure!(
                    connection.version == version && connection.status != "disconnected",
                    "connection changed"
                );
                let provider = self.catalog.provider(&connection.provider_id)?;
                ensure!(
                    matches!(
                        provider.authentication,
                        catalog::Authentication::Bearer | catalog::Authentication::ApiKey { .. }
                    ),
                    "provider does not support static tokens"
                );
                let credential = Credential {
                    access_token: token.to_string(),
                    refresh_token: None,
                    revocation: None,
                };
                let raw = Zeroizing::new(serde_json::to_vec(&credential)?);
                let envelope = self.vault.encrypt(id, owner, &provider.id, &raw)?;
                self.store
                    .save_credentials(&connection, &envelope, &[], None)
                    .await?;
                Ok(json!({"connection":self.store.connection(id).await?}))
            }
            Command::OAuthStart { id } => {
                let connection = self.connection(&context, id).await?;
                let provider = self.catalog.provider(&connection.provider_id)?;
                Ok(
                    json!({"authorizationUrl":oauth::begin(&self.store,&self.vault,provider,&connection,&context.session_id,&self.callback).await?}),
                )
            }
            Command::OAuthFinish { state, code } => {
                let row=self.store.pool.get().await?.query_opt("SELECT c.provider_id FROM relay.oauth_attempts a JOIN relay.connections c ON c.id=a.connection_id WHERE a.state_hash=$1 AND a.owner_id=$2 AND a.session_hash=$3 AND NOT a.consumed AND a.expires_at>clock_timestamp()", &[&oauth::hash(&state),&owner,&oauth::hash(&context.session_id)]).await?.context("OAuth attempt unavailable")?;
                let provider = self.catalog.provider(&row.get::<_, String>(0))?;
                let id = oauth::finish(
                    &self.store,
                    &self.vault,
                    &self.network,
                    provider,
                    oauth::OwnerSession {
                        owner,
                        session: &context.session_id,
                    },
                    &state,
                    &code,
                )
                .await?;
                self.connection(&context, id).await?;
                Ok(json!({"connection":self.store.connection(id).await?}))
            }
            Command::ConnectClient { id } => {
                let connection = self.connection(&context, id).await?;
                let provider = self.catalog.provider(&connection.provider_id)?;
                oauth::client_credentials(
                    &self.store,
                    &self.vault,
                    &self.network,
                    provider,
                    &connection,
                )
                .await?;
                Ok(json!({"connection":self.store.connection(id).await?}))
            }
            Command::Bind {
                id,
                workspace,
                operations,
                constraints,
            } => {
                let connection = self.connection(&context, id).await?;
                ensure!(
                    connection.status == "connected" && operations.len() <= 128,
                    "connection is not ready"
                );
                self.policy
                    .check(
                        &context,
                        Action::GrantsManage,
                        ResourceKind::Workspace,
                        &workspace.to_string(),
                        "",
                        "",
                    )
                    .await?;
                let provider = self.catalog.provider(&connection.provider_id)?;
                ensure!(
                    operations
                        .iter()
                        .all(|name| provider.operations.contains_key(name))
                        && constraints.len() <= 32
                        && constraints
                            .iter()
                            .all(|(pointer, values)| pointer.starts_with('/')
                                && pointer.len() <= 256
                                && !values.is_empty()
                                && values.len() <= 128)
                        && serde_json::to_vec(&constraints)?.len() <= 65536,
                    "invalid workspace operation scope"
                );
                self.store.pool.get().await?.execute("INSERT INTO relay.workspace_bindings(connection_id,workspace_uid,operations,constraints) VALUES($1,$2,$3,$4) ON CONFLICT(connection_id,workspace_uid) DO UPDATE SET operations=excluded.operations,constraints=excluded.constraints,version=relay.workspace_bindings.version+1", &[&id,&workspace,&operations,&serde_json::to_value(constraints)?]).await?;
                Ok(json!({"saved":true}))
            }
            Command::Disconnect { id } => {
                let connection = self.connection(&context, id).await?;
                let revoke = if let Some(envelope) = &connection.credential {
                    let raw = self
                        .vault
                        .decrypt(id, owner, &connection.provider_id, envelope)?;
                    let credential: Credential = serde_json::from_slice(&raw)?;
                    credential.revocation.is_some()
                } else {
                    false
                };
                self.store.disconnect(id, owner, revoke).await?;
                Ok(json!({"disconnected":true}))
            }
            Command::AckCleanup { id, workspace } => {
                self.store.pool.get().await?.execute("DELETE FROM relay.agent_cleanups a USING relay.connections c WHERE a.connection_id=c.id AND c.owner_id=$1 AND a.connection_id=$2 AND a.workspace_uid=$3", &[&owner,&id,&workspace]).await?;
                Ok(json!({"acknowledged":true}))
            }
            Command::StageGrant {
                id,
                workspace,
                grant_id,
                expires_at,
            } => {
                self.connection(&context, id).await?;
                self.policy
                    .check(
                        &context,
                        Action::GrantsManage,
                        ResourceKind::Workspace,
                        &workspace.to_string(),
                        "",
                        "",
                    )
                    .await?;
                ensure!(
                    expires_at > chrono::Utc::now()
                        && expires_at <= chrono::Utc::now() + chrono::Duration::hours(1),
                    "grant deadline must be bounded"
                );
                let count:i64=self.store.pool.get().await?.query_one("SELECT count(*) FROM relay.grant_installations g JOIN relay.connections c ON c.id=g.connection_id WHERE c.owner_id=$1 AND g.expires_at>clock_timestamp()",&[&owner]).await?.get(0);
                ensure!(count < 128, "too many outstanding connector installations");
                self.store.pool.get().await?.execute("INSERT INTO relay.grant_installations(grant_id,connection_id,workspace_uid,status,expires_at) VALUES($1,$2,$3,'pending',$4)",&[&grant_id,&id,&workspace,&expires_at]).await?;
                Ok(json!({"staged":true}))
            }
            Command::SetGrantStatus { grant_id, status } => {
                let row=self.store.pool.get().await?.query_opt("SELECT g.connection_id,g.workspace_uid FROM relay.grant_installations g JOIN relay.connections c ON c.id=g.connection_id WHERE g.grant_id=$1 AND c.owner_id=$2",&[&grant_id,&owner]).await?.context("connector installation unavailable")?;
                if status == GrantStatus::Active {
                    let id: Uuid = row.get(0);
                    let workspace: Uuid = row.get(1);
                    self.connection(&context, id).await?;
                    let mut workspace_context = context.clone();
                    workspace_context.workspace_uid = workspace.to_string();
                    self.policy
                        .check(
                            &workspace_context,
                            Action::GrantsManage,
                            ResourceKind::Workspace,
                            &workspace.to_string(),
                            "",
                            "",
                        )
                        .await?;
                    let changed=self.store.pool.get().await?.execute("UPDATE relay.grant_installations SET status='active' WHERE grant_id=$1 AND status IN ('pending','active') AND revoke_after>clock_timestamp() AND expires_at>clock_timestamp()",&[&grant_id]).await?;
                    ensure!(changed == 1, "connector installation expired or cancelled");
                } else {
                    let value = if status == GrantStatus::Revoked {
                        "revoked"
                    } else {
                        "cancelled"
                    };
                    self.store.pool.get().await?.execute("UPDATE relay.grant_installations SET status=$1 WHERE grant_id=$2 AND status<>'revoked'",&[&value,&grant_id]).await?;
                }
                Ok(json!({"updated":true}))
            }
            Command::Invoke {
                id,
                workspace,
                operation,
                arguments,
            } => {
                ensure!(
                    self.store.connection(id).await?.owner_id == owner,
                    "connection unavailable"
                );
                self.policy
                    .check(
                        &context,
                        Action::CodexControl,
                        ResourceKind::Workspace,
                        &workspace.to_string(),
                        "",
                        "",
                    )
                    .await?;
                self.invoke(&context, id, workspace, &operation, arguments, None)
                    .await
            }
            Command::AgentInvoke { .. } => unreachable!(),
        }
    }
    async fn check_binding(
        &self,
        id: Uuid,
        workspace: Uuid,
        operation: &str,
        arguments: &Value,
    ) -> Result<i64> {
        let row=self.store.pool.get().await?.query_opt("SELECT b.version,b.operations,b.constraints,c.status FROM relay.workspace_bindings b JOIN relay.connections c ON c.id=b.connection_id WHERE b.connection_id=$1 AND b.workspace_uid=$2", &[&id,&workspace]).await?.context("connection is not enabled for this workspace")?;
        ensure!(
            matches!(row.get::<_, String>(3).as_str(), "connected" | "refreshing")
                && row
                    .get::<_, Vec<String>>(1)
                    .iter()
                    .any(|allowed| allowed == operation),
            "operation is not enabled for this workspace"
        );
        let constraints: BTreeMap<String, Vec<Value>> = serde_json::from_value(row.get(2))?;
        for (pointer, allowed) in constraints {
            ensure!(
                arguments
                    .pointer(&pointer)
                    .is_some_and(|value| allowed.contains(value)),
                "operation arguments exceed this workspace's resource scope"
            );
        }
        Ok(row.get(0))
    }
    async fn invoke(
        &self,
        context: &RequestContext,
        id: Uuid,
        workspace: Uuid,
        operation: &str,
        arguments: Value,
        authorized: Option<proto::CheckResponse>,
    ) -> Result<Value> {
        let principal = workspace.to_string();
        let semaphore = {
            let mut principals = self.principals.lock().await;
            principals.retain(|_, semaphore| Arc::strong_count(semaphore) > 1);
            principals
                .entry(principal)
                .or_insert_with(|| Arc::new(Semaphore::new(8)))
                .clone()
        };
        let _principal = semaphore
            .try_acquire_owned()
            .context("workspace connector capacity reached")?;
        self.check_binding(id, workspace, operation, &arguments)
            .await?;
        let before = self.store.connection(id).await?;
        let provider = self.catalog.provider(&before.provider_id)?;
        let spec = self
            .catalog
            .operation(&provider.id, operation, &arguments)?;
        let action = if spec.read_only {
            Action::ConnectorRead
        } else {
            Action::ConnectorInvoke
        };
        let initial = if let Some(decision) = authorized {
            policy::validate(&decision)?;
            decision
        } else {
            self.policy
                .check(
                    context,
                    action,
                    ResourceKind::ConnectorConnection,
                    &id.to_string(),
                    operation,
                    "",
                )
                .await?
        };
        let (connection, credential) =
            oauth::credential(&self.store, &self.vault, &self.network, provider, id).await?;
        ensure!(
            spec.required_scopes
                .iter()
                .all(|scope| connection.scopes.contains(scope)),
            "connection is missing required provider scopes"
        );
        let header = match &provider.authentication {
            catalog::Authentication::None => None,
            catalog::Authentication::ApiKey { header } => Some((
                header.parse()?,
                http::HeaderValue::from_str(&credential.access_token)?,
            )),
            _ => Some((
                http::header::AUTHORIZATION,
                http::HeaderValue::from_str(&format!("Bearer {}", credential.access_token))?,
            )),
        };
        let authentication = upstream::Authentication { header };
        let invocation = Uuid::new_v4();
        self.store.pool.get().await?.execute("INSERT INTO relay.invocations(id,connection_id,workspace_uid,operation,receipt_id,outcome) VALUES($1,$2,$3,$4,$5,'started')", &[&invocation,&id,&workspace,&operation,&initial.audit_receipt_id]).await?;
        let authorize = || async {
            self.check_binding(id, workspace, operation, &arguments)
                .await?;
            let current = self.store.connection(id).await?;
            ensure!(
                current.version == connection.version && current.status == "connected",
                "connection changed before dispatch"
            );
            self.policy
                .check(
                    context,
                    action,
                    ResourceKind::ConnectorConnection,
                    &id.to_string(),
                    operation,
                    &initial.audit_receipt_id,
                )
                .await?;
            Ok(())
        };
        let result = tokio::time::timeout(
            Duration::from_secs(30),
            upstream::execute(
                &self.network,
                provider,
                spec,
                arguments.clone(),
                &authentication,
                authorize,
            ),
        )
        .await;
        let result = match result {
            Ok(result) => result,
            Err(_) => Err(anyhow::anyhow!("connector request exceeded its deadline")),
        };
        if result.is_err() {
            let outcome = if spec.read_only { "failed" } else { "unknown" };
            self.store.pool.get().await?.execute("UPDATE relay.invocations SET outcome=$1,completed_at=clock_timestamp() WHERE id=$2", &[&outcome,&invocation]).await?;
        }
        let result = result?;
        let disclosure: Result<()> = async {
            if let Some(scope) = &initial.effective_scope {
                ensure!(
                    serde_json::to_vec(&result)?.len() <= scope.max_bytes as usize
                        && array_items(&result) <= scope.max_items as usize,
                    "connector result exceeded its grant budget"
                );
            }
            self.check_binding(id, workspace, operation, &arguments)
                .await?;
            self.policy
                .check(
                    context,
                    action,
                    ResourceKind::ConnectorConnection,
                    &id.to_string(),
                    operation,
                    &initial.audit_receipt_id,
                )
                .await?;
            ensure!(
                !contains_credentials(&result, &credential),
                "provider response contains credential material"
            );
            Ok(())
        }
        .await;
        self.store.pool.get().await?.execute("UPDATE relay.invocations SET outcome=$1,completed_at=clock_timestamp() WHERE id=$2", &[&if disclosure.is_ok(){"succeeded"}else{"withheld"},&invocation]).await?;
        disclosure?;
        Ok(
            json!({"result":result,"invocationId":invocation,"auditReceiptId":initial.audit_receipt_id}),
        )
    }
}

fn contains_secret(value: &Value, secret: &str) -> bool {
    if secret.is_empty() {
        return false;
    }
    match value {
        Value::String(value) => value.contains(secret),
        Value::Array(values) => values.iter().any(|v| contains_secret(v, secret)),
        Value::Object(values) => values
            .iter()
            .any(|(k, v)| k.contains(secret) || contains_secret(v, secret)),
        _ => false,
    }
}

fn array_items(value: &Value) -> usize {
    match value {
        Value::Array(values) => values
            .len()
            .saturating_add(values.iter().map(array_items).sum::<usize>()),
        Value::Object(values) => values.values().map(array_items).sum(),
        _ => 0,
    }
}

fn contains_credentials(value: &Value, credential: &Credential) -> bool {
    contains_secret(value, &credential.access_token)
        || credential
            .refresh_token
            .as_ref()
            .is_some_and(|secret| contains_secret(value, secret))
        || credential
            .revocation
            .as_ref()
            .and_then(|snapshot| snapshot.client_secret.as_ref())
            .is_some_and(|secret| contains_secret(value, secret))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::OAuthClientAuthentication;
    use crate::oauth::Revocation;

    #[test]
    fn response_disclosure_rejects_every_retained_credential() {
        let credential = Credential {
            access_token: "fixture-access-secret".into(),
            refresh_token: Some("fixture-refresh-secret".into()),
            revocation: Some(Revocation {
                endpoint: "https://provider.example/revoke".into(),
                client_id: "fixture-client".into(),
                client_authentication: OAuthClientAuthentication::ClientSecretBasic,
                client_secret: Some("fixture-application-secret".into()),
            }),
        };
        assert!(!contains_credentials(
            &json!({"items":["ordinary result"]}),
            &credential
        ));
        for secret in [
            "fixture-access-secret",
            "fixture-refresh-secret",
            "fixture-application-secret",
        ] {
            assert!(contains_credentials(
                &json!({"nested":[{"value":secret}]}),
                &credential
            ));
            assert!(contains_credentials(
                &json!({format!("prefix-{secret}"):true}),
                &credential
            ));
        }
    }
}

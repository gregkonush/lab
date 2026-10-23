use super::*;
use anyhow::{Result, ensure};
use async_trait::async_trait;
use authz_proto::{
    Action, Actor, CheckConnectorAgentRequest, CheckConnectorAgentResponse, CheckResponse,
    RequestContext, ResourceKind, actor::Identity,
};
use axum::{Json, Router, extract::State, routing::post};
use base64::{Engine, engine::general_purpose::STANDARD};
use http_body_util::BodyExt;
use hyper_util::{
    rt::{TokioExecutor, TokioIo},
    server::conn::auto::Builder,
    service::TowerToHyperService,
};
use prost::Message;
use serde_json::{Value, json};
use std::{
    env,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};
use tokio::{net::TcpListener, sync::Notify};
use tokio_postgres_rustls::MakeRustlsConnect;
use tokio_rustls::TlsAcceptor;
use uuid::Uuid;

#[derive(Clone)]
struct Authority {
    allowed: Arc<AtomicBool>,
    checks: Arc<AtomicUsize>,
}
#[async_trait]
impl policy::Policy for Authority {
    async fn check(
        &self,
        _: &RequestContext,
        _: Action,
        _: ResourceKind,
        _: &str,
        _: &str,
        _: &str,
    ) -> Result<CheckResponse> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        ensure!(self.allowed.load(Ordering::SeqCst), "revoked");
        Ok(CheckResponse {
            allowed: true,
            audit_receipt_id: Uuid::new_v4().to_string(),
            revision: "fixture".into(),
            valid_until_unix_ms: policy::now_ms() + 2000,
            recovery_generation: 1,
            ..Default::default()
        })
    }
    async fn agent(&self, _: CheckConnectorAgentRequest) -> Result<CheckConnectorAgentResponse> {
        anyhow::bail!("separate Ofz proof fixture required")
    }
}
#[derive(Clone)]
struct ProviderState {
    refreshes: Arc<AtomicUsize>,
    calls: Arc<AtomicUsize>,
    delay: Arc<AtomicBool>,
    entered: Arc<Notify>,
    release: Arc<Notify>,
    revocations: Arc<AtomicUsize>,
    fail_refresh: Arc<AtomicBool>,
    pause_refresh: Arc<AtomicBool>,
}
async fn provider(
    State(state): State<ProviderState>,
    request: axum::extract::Request,
) -> Json<Value> {
    let path = request.uri().path().to_owned();
    let auth = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let api_key = request
        .headers()
        .get("x-api-key")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let bytes = request.into_body().collect().await.unwrap().to_bytes();
    if path == "/revoke" {
        let values: std::collections::BTreeMap<_, _> =
            url::form_urlencoded::parse(&bytes).into_owned().collect();
        assert!(matches!(
            values["token"].as_str(),
            "rotated-refresh-token" | "first-refresh-token" | "client-access-token"
        ));
        if values["token"] == "client-access-token" {
            assert_eq!(
                auth,
                format!(
                    "Basic {}",
                    STANDARD.encode("fixture%3Aclient:disposable+application%2Bsecret")
                )
            );
        }
        state.revocations.fetch_add(1, Ordering::SeqCst);
        return Json(json!({}));
    }
    if path == "/client-token" {
        let values: std::collections::BTreeMap<_, _> =
            url::form_urlencoded::parse(&bytes).into_owned().collect();
        assert_eq!(values["grant_type"], "client_credentials");
        assert_eq!(
            auth,
            format!(
                "Basic {}",
                STANDARD.encode("fixture%3Aclient:disposable+application%2Bsecret")
            )
        );
        return Json(
            json!({"access_token":"client-access-token","token_type":"Bearer","expires_in":3600,"scope":"read"}),
        );
    }
    if path == "/token" {
        let form: url::form_urlencoded::Parse<'_> = url::form_urlencoded::parse(&bytes);
        let values: std::collections::BTreeMap<_, _> = form.into_owned().collect();
        if values["grant_type"] == "authorization_code" {
            assert_eq!(values["code"], "one-use-code");
            assert_eq!(values["code_verifier"].len(), 43);
            return Json(
                json!({"access_token":"first-access-token","refresh_token":"first-refresh-token","token_type":"Bearer","expires_in":1,"scope":"read"}),
            );
        }
        assert_eq!(values["grant_type"], "refresh_token");
        assert_eq!(values["refresh_token"], "first-refresh-token");
        state.refreshes.fetch_add(1, Ordering::SeqCst);
        if state.fail_refresh.load(Ordering::SeqCst) {
            return Json(json!({"error":"invalid_grant"}));
        }
        if state.pause_refresh.load(Ordering::SeqCst) {
            state.entered.notify_one();
            state.release.notified().await;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
        return Json(
            json!({"access_token":"rotated-access-token","refresh_token":"rotated-refresh-token","token_type":"Bearer","expires_in":3600,"scope":"read"}),
        );
    }
    if state.delay.load(Ordering::SeqCst) {
        state.entered.notify_one();
        state.release.notified().await;
    }
    state.calls.fetch_add(1, Ordering::SeqCst);
    if path == "/graphql" {
        assert_eq!(api_key, "static-credential");
        assert!(auth.is_empty());
        let value: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            value["query"],
            "query Fixture($repository:String){repository(name:$repository){name}}"
        );
        assert_eq!(value["variables"]["repository"], "allowed");
        return Json(json!({"data":{"repository":{"name":"allowed"}}}));
    }
    assert!(matches!(
        auth.as_str(),
        "Bearer rotated-access-token" | "Bearer static-credential"
    ));
    if path == "/mcp" {
        let value: Value = serde_json::from_slice(&bytes).unwrap();
        return Json(match value["method"].as_str().unwrap() {
            "initialize" => {
                json!({"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-11-25","capabilities":{},"serverInfo":{"name":"fixture","version":"1"}}})
            }
            "notifications/initialized" => Value::Null,
            "tools/call" => {
                assert_eq!(value["params"]["name"], "search");
                json!({"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"MCP result"}]}})
            }
            _ => panic!("unsupported fixture request"),
        });
    }
    if path == "/echo-secret" {
        return Json(json!({"leaked":"static-credential"}));
    }
    Json(json!({"items":[{"name":"API result"}]}))
}

async fn database() -> Result<store::Store> {
    let mut config: tokio_postgres::Config = env::var("RELAY_TEST_DSN")?.parse()?;
    config.password(std::fs::read_to_string(env::var(
        "RELAY_TEST_PASSWORD_FILE",
    )?)?);
    let mut roots = rustls::RootCertStore::empty();
    let bytes = std::fs::read(env::var("RELAY_TEST_CA_FILE")?)?;
    for cert in rustls_pemfile::certs(&mut bytes.as_slice()) {
        roots.add(cert?)?;
    }
    store::Store::new(
        config,
        MakeRustlsConnect::new(
            rustls::ClientConfig::builder()
                .with_root_certificates(roots)
                .with_no_client_auth(),
        ),
    )
}
fn input(context: &RequestContext, command: Value) -> service::Input {
    serde_json::from_value(
        json!({"context":STANDARD.encode(context.encode_to_vec()),"command":command}),
    )
    .unwrap()
}

#[tokio::test]
#[ignore = "requires the isolated PostgreSQL/TLS provider fixture in test-integration.sh"]
async fn database_oauth_api_mcp_refresh_revocation_and_disconnect() -> Result<()> {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let store = database().await?;
    store.migrate().await?;
    store.verify().await?;
    let state = ProviderState {
        refreshes: Arc::new(AtomicUsize::new(0)),
        calls: Arc::new(AtomicUsize::new(0)),
        delay: Arc::new(AtomicBool::new(false)),
        entered: Arc::new(Notify::new()),
        release: Arc::new(Notify::new()),
        revocations: Arc::new(AtomicUsize::new(0)),
        fail_refresh: Arc::new(AtomicBool::new(false)),
        pause_refresh: Arc::new(AtomicBool::new(false)),
    };
    let router = Router::new()
        .route("/token", post(provider))
        .route("/client-token", post(provider))
        .route("/revoke", post(provider))
        .route("/graphql", post(provider))
        .route("/api", post(provider))
        .route("/mcp", post(provider))
        .route("/echo-secret", post(provider))
        .route(
            "/write-fail",
            post(|| async { http::StatusCode::BAD_GATEWAY }),
        )
        .with_state(state.clone());
    let certs =
        rustls_pemfile::certs(&mut std::fs::read(env::var("RELAY_TEST_CERT_FILE")?)?.as_slice())
            .collect::<std::result::Result<Vec<_>, _>>()?;
    let key = rustls_pemfile::private_key(
        &mut std::fs::read(env::var("RELAY_TEST_KEY_FILE")?)?.as_slice(),
    )?
    .unwrap();
    let tls = rustls::ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;
    let acceptor = TlsAcceptor::from(Arc::new(tls));
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let server = tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            let acceptor = acceptor.clone();
            let router = router.clone();
            tokio::spawn(async move {
                let stream = acceptor.accept(tcp).await.unwrap();
                let builder = Builder::new(TokioExecutor::new());
                let _ = builder
                    .serve_connection(TokioIo::new(stream), TowerToHyperService::new(router))
                    .await;
            });
        }
    });
    let operation = |transport: Value| json!({"description":"Read fixture data","inputSchema":{"type":"object","properties":{"repository":{"type":"string"}},"additionalProperties":false},"readOnly":true,"requiredScopes":[],"transport":transport});
    let providers = json!([
        {"id":"oauth-api","version":"v1","name":"OAuth API","endpoint":"https://provider.example","authentication":{"kind":"oAuth2","authorizationEndpoint":"https://provider.example/authorize","tokenEndpoint":"https://provider.example/token","revocationEndpoint":"https://provider.example/revoke","clientId":"fixture-client","clientSecretFile":null,"grant":"authorizationCode","scopes":["read"]},"operations":{"list":operation(json!({"kind":"http","method":"POST","path":"/api"}))}},
        {"id":"mcp","version":"v1","name":"MCP","endpoint":"https://provider.example/mcp","authentication":{"kind":"bearer"},"operations":{"search":operation(json!({"kind":"mcp","tool":"search"})),"echo":operation(json!({"kind":"http","method":"POST","path":"/echo-secret"}))}}
    ]);
    let mut providers = providers;
    let mut write = operation(json!({"kind":"http","method":"POST","path":"/write-fail"}));
    write["readOnly"] = json!(false);
    providers[1]["operations"]["write"] = write;
    providers.as_array_mut().unwrap().push(json!({"id":"graphql","version":"v1","name":"GraphQL API","endpoint":"https://provider.example","authentication":{"kind":"apiKey","header":"x-api-key"},"operations":{"repository":operation(json!({"kind":"graphql","path":"/graphql","document":"query Fixture($repository:String){repository(name:$repository){name}}"}))}}));
    let catalog = catalog::Catalog::from_json(&serde_json::to_vec(&providers)?)?;
    let vault = crypto::Vault::from_json(&serde_json::to_vec(
        &json!({"active":"v1","keys":{"v1":STANDARD.encode([27;32])}}),
    )?)?;
    let authority = Authority {
        allowed: Arc::new(AtomicBool::new(true)),
        checks: Arc::new(AtomicUsize::new(0)),
    };
    let mut service = service::Service::new(
        store.clone(),
        vault,
        catalog,
        Arc::new(authority.clone()),
        "https://proompteng.ai/api/tengri/connectors/callback".into(),
    );
    service.network.fixture = Some((
        address,
        reqwest::Certificate::from_pem(&std::fs::read(env::var("RELAY_TEST_CA_FILE")?)?)?,
    ));
    let service = Arc::new(service);
    let context = RequestContext {
        actor: Some(Actor {
            identity: Some(Identity::HumanId("a".repeat(64))),
        }),
        session_id: Uuid::new_v4().to_string(),
        trace_id: Uuid::new_v4().to_string(),
        origin: "https://proompteng.ai".into(),
        contract_version: 1,
        deadline_unix_ms: policy::now_ms() + 25000,
        ..Default::default()
    };
    let id = Uuid::new_v4();
    let workspace = Uuid::new_v4();
    service
        .handle(input(
            &context,
            json!({"action":"create","id":id,"provider":"oauth-api","name":"My API account"}),
        ))
        .await?;
    let authorized = service
        .handle(input(&context, json!({"action":"oAuthStart","id":id})))
        .await?;
    let authorization = url::Url::parse(authorized["authorizationUrl"].as_str().unwrap())?;
    let params: std::collections::BTreeMap<_, _> =
        authorization.query_pairs().into_owned().collect();
    assert_eq!(params["code_challenge_method"], "S256");
    let finish = json!({"action":"oAuthFinish","state":params["state"],"code":"one-use-code"});
    let mut stranger = context.clone();
    stranger.actor.as_mut().unwrap().identity = Some(Identity::HumanId("b".repeat(64)));
    assert!(
        service
            .handle(input(&stranger, finish.clone()))
            .await
            .is_err()
    );
    service.handle(input(&context, finish.clone())).await?;
    assert!(service.handle(input(&context, finish)).await.is_err());
    service.handle(input(&context,json!({"action":"bind","id":id,"workspace":workspace,"operations":["list"],"constraints":{"/repository":["allowed"]}}))).await?;
    let call = json!({"action":"invoke","id":id,"workspace":workspace,"operation":"list","arguments":{"repository":"allowed"}});
    let (first, second) = tokio::join!(
        service.handle(input(&context, call.clone())),
        service.handle(input(&context, call.clone()))
    );
    assert_eq!(first?["result"]["items"][0]["name"], "API result");
    second?;
    assert_eq!(state.refreshes.load(Ordering::SeqCst), 1);
    let record = store.connection(id).await?;
    let encrypted = serde_json::to_string(&record.credential)?;
    assert!(
        !encrypted.contains("rotated-access-token") && !encrypted.contains("rotated-refresh-token")
    );
    assert!(service.handle(input(&context,json!({"action":"invoke","id":id,"workspace":workspace,"operation":"list","arguments":{"repository":"other"}}))).await.is_err());
    assert!(
        service
            .handle(input(&stranger, call.clone()))
            .await
            .is_err()
    );
    let mcp = Uuid::new_v4();
    service
        .handle(input(
            &context,
            json!({"action":"create","id":mcp,"provider":"mcp","name":"MCP account"}),
        ))
        .await?;
    service
        .handle(input(
            &context,
            json!({"action":"connectToken","id":mcp,"version":1,"token":"static-credential"}),
        ))
        .await?;
    service.handle(input(&context,json!({"action":"bind","id":mcp,"workspace":workspace,"operations":["search","echo","write"],"constraints":{}}))).await?;
    let staged = Uuid::new_v4();
    let expiry = (chrono::Utc::now() + chrono::Duration::minutes(59)).to_rfc3339();
    service.handle(input(&context,json!({"action":"stageGrant","id":mcp,"workspace":workspace,"grantId":staged,"expiresAt":expiry}))).await?;
    let staged_call = || {
        serde_json::from_value::<service::Input>(json!({"command":{"action":"agentInvoke","grantId":staged,"credential":"a".repeat(43),"proof":"fixture","body":STANDARD.encode(serde_json::to_vec(&json!({"connectionId":mcp,"operation":"search","arguments":{}})).unwrap())}})).unwrap()
    };
    let checks = authority.checks.load(Ordering::SeqCst);
    assert!(
        service
            .handle(staged_call())
            .await
            .unwrap_err()
            .to_string()
            .contains("not confirmed")
    );
    assert_eq!(authority.checks.load(Ordering::SeqCst), checks);
    service
        .handle(input(
            &context,
            json!({"action":"setGrantStatus","grantId":staged,"status":"active"}),
        ))
        .await?;
    assert!(
        service
            .handle(staged_call())
            .await
            .unwrap_err()
            .to_string()
            .contains("separate Ofz proof fixture"),
        "activation still requires canonical proof verification"
    );
    service
        .handle(input(
            &context,
            json!({"action":"setGrantStatus","grantId":staged,"status":"cancelled"}),
        ))
        .await?;
    assert!(
        service
            .handle(staged_call())
            .await
            .unwrap_err()
            .to_string()
            .contains("not confirmed")
    );
    assert!(
        service
            .handle(input(
                &context,
                json!({"action":"setGrantStatus","grantId":staged,"status":"active"})
            ))
            .await
            .is_err(),
        "cancelled installations cannot reactivate"
    );
    let pending = service
        .handle(input(&context, json!({"action":"list"})))
        .await?;
    assert!(
        pending["grantCleanups"]
            .as_array()
            .unwrap()
            .iter()
            .any(|job| job["grantId"] == staged.to_string()),
        "failed installations remain queued durably"
    );
    let result=service.handle(input(&context,json!({"action":"invoke","id":mcp,"workspace":workspace,"operation":"search","arguments":{}}))).await?;
    assert_eq!(result["result"]["content"][0]["text"], "MCP result");
    assert!(service.handle(input(&context,json!({"action":"invoke","id":mcp,"workspace":workspace,"operation":"echo","arguments":{}}))).await.is_err());
    assert!(service.handle(input(&context,json!({"action":"invoke","id":mcp,"workspace":workspace,"operation":"write","arguments":{}}))).await.is_err());
    let outcome: String = store
        .pool
        .get()
        .await?
        .query_one(
            "SELECT outcome FROM relay.invocations WHERE connection_id=$1 AND operation='write'",
            &[&mcp],
        )
        .await?
        .get(0);
    assert_eq!(outcome, "unknown");
    // API-key authenticated GraphQL uses the reviewed document and separate variables.
    let graphql = Uuid::new_v4();
    service
        .handle(input(
            &context,
            json!({"action":"create","id":graphql,"provider":"graphql","name":"GraphQL"}),
        ))
        .await?;
    service
        .handle(input(
            &context,
            json!({"action":"connectToken","id":graphql,"version":1,"token":"static-credential"}),
        ))
        .await?;
    service.handle(input(&context,json!({"action":"bind","id":graphql,"workspace":workspace,"operations":["repository"],"constraints":{}}))).await?;
    let graph=service.handle(input(&context,json!({"action":"invoke","id":graphql,"workspace":workspace,"operation":"repository","arguments":{"repository":"allowed"}}))).await?;
    assert_eq!(graph["result"]["data"]["repository"]["name"], "allowed");
    // Application-secret client authentication is exercised with a disposable mounted-file equivalent.
    let secret = tempfile::NamedTempFile::new()?;
    std::fs::write(secret.path(), "disposable application+secret")?;
    let mut client_provider = service.catalog.provider("oauth-api")?.clone();
    client_provider.id = "client".into();
    if let catalog::Authentication::OAuth2 {
        token_endpoint,
        client_id,
        client_secret_file,
        client_authentication,
        grant,
        ..
    } = &mut client_provider.authentication
    {
        *token_endpoint = "https://provider.example/client-token".into();
        *client_id = "fixture:client".into();
        *client_secret_file = Some(secret.path().to_str().unwrap().into());
        *client_authentication = catalog::OAuthClientAuthentication::ClientSecretBasic;
        *grant = catalog::OAuthGrant::ClientCredentials;
    }
    let client_id = Uuid::new_v4();
    let client_connection = store
        .create(client_id, &"a".repeat(64), "client", "v1", "Client")
        .await?;
    oauth::client_credentials(
        &store,
        &service.vault,
        &service.network,
        &client_provider,
        &client_connection,
    )
    .await?;
    let (_, credential) = oauth::credential(
        &store,
        &service.vault,
        &service.network,
        &client_provider,
        client_id,
    )
    .await?;
    assert_eq!(credential.access_token, "client-access-token");
    assert_eq!(
        credential
            .revocation
            .as_ref()
            .unwrap()
            .client_secret
            .as_deref(),
        Some("disposable application+secret")
    );
    // The queued encrypted snapshot remains usable after the mounted application secret is gone.
    secret.close()?;
    store.disconnect(client_id, &"a".repeat(64), true).await?;
    // Invalid/uncertain refresh is not retried with a potentially consumed rotating token.
    let uncertain = Uuid::new_v4();
    let before = store
        .create(
            uncertain,
            &"a".repeat(64),
            "oauth-api",
            "v1",
            "Uncertain refresh",
        )
        .await?;
    let envelope = service.vault.encrypt(
        uncertain,
        &before.owner_id,
        &before.provider_id,
        br#"{"accessToken":"expired","refreshToken":"first-refresh-token","revocation":{"endpoint":"https://provider.example/revoke","clientId":"fixture-client","clientAuthentication":"none","clientSecret":null}}"#,
    )?;
    store
        .save_credentials(
            &before,
            &envelope,
            &["read".into()],
            Some(chrono::Utc::now()),
        )
        .await?;
    state.fail_refresh.store(true, Ordering::SeqCst);
    let prior = state.refreshes.load(Ordering::SeqCst);
    for _ in 0..2 {
        assert!(
            oauth::credential(
                &store,
                &service.vault,
                &service.network,
                service.catalog.provider("oauth-api")?,
                uncertain
            )
            .await
            .is_err()
        );
    }
    assert_eq!(state.refreshes.load(Ordering::SeqCst), prior + 1);
    assert_eq!(store.connection(uncertain).await?.status, "reconnect");
    state.fail_refresh.store(false, Ordering::SeqCst);
    // Disconnect during rotating refresh revokes both old and newly issued credentials.
    let racing = Uuid::new_v4();
    let before = store
        .create(racing, &"a".repeat(64), "oauth-api", "v1", "Racing refresh")
        .await?;
    let envelope = service.vault.encrypt(
        racing,
        &before.owner_id,
        &before.provider_id,
        br#"{"accessToken":"expired","refreshToken":"first-refresh-token","revocation":{"endpoint":"https://provider.example/revoke","clientId":"fixture-client","clientAuthentication":"none","clientSecret":null}}"#,
    )?;
    store
        .save_credentials(
            &before,
            &envelope,
            &["read".into()],
            Some(chrono::Utc::now()),
        )
        .await?;
    state.pause_refresh.store(true, Ordering::SeqCst);
    let refreshing = {
        let service = service.clone();
        tokio::spawn(async move {
            oauth::credential(
                &service.store,
                &service.vault,
                &service.network,
                service.catalog.provider("oauth-api")?,
                racing,
            )
            .await
        })
    };
    state.entered.notified().await;
    store.disconnect(racing, &before.owner_id, true).await?;
    state.release.notify_one();
    assert!(refreshing.await?.is_err());
    assert!(store.connection(racing).await?.credential.is_none());
    let jobs: i64 = store
        .pool
        .get()
        .await?
        .query_one(
            "SELECT count(*) FROM relay.revocations WHERE connection_id=$1",
            &[&racing],
        )
        .await?
        .get(0);
    assert_eq!(jobs, 2);
    state.pause_refresh.store(false, Ordering::SeqCst);
    state.delay.store(true, Ordering::SeqCst);
    let pending = {
        let service = service.clone();
        let input = input(&context, call.clone());
        tokio::spawn(async move { service.handle(input).await })
    };
    state.entered.notified().await;
    service
        .handle(input(&context, json!({"action":"disconnect","id":id})))
        .await?;
    state.release.notify_one();
    assert!(pending.await?.is_err());
    assert!(store.connection(id).await?.credential.is_none());
    let cleanups = service
        .handle(input(&context, json!({"action":"list"})))
        .await?;
    assert!(
        cleanups["cleanups"]
            .as_array()
            .unwrap()
            .iter()
            .any(|job| job["connectionId"] == id.to_string()
                && job["workspaceUid"] == workspace.to_string())
    );
    // Bindings are gone, but durable cleanup remains discoverable after service/BFF restarts.
    let bindings: i64 = store
        .pool
        .get()
        .await?
        .query_one(
            "SELECT count(*) FROM relay.workspace_bindings WHERE connection_id=$1",
            &[&id],
        )
        .await?
        .get(0);
    assert_eq!(bindings, 0);
    service
        .handle(input(
            &stranger,
            json!({"action":"ackCleanup","id":id,"workspace":workspace}),
        ))
        .await?;
    let pending: i64 = store
        .pool
        .get()
        .await?
        .query_one(
            "SELECT count(*) FROM relay.agent_cleanups WHERE connection_id=$1",
            &[&id],
        )
        .await?
        .get(0);
    assert_eq!(pending, 1, "another owner cannot acknowledge this cleanup");
    service
        .handle(input(
            &context,
            json!({"action":"ackCleanup","id":id,"workspace":workspace}),
        ))
        .await?;
    let pending: i64 = store
        .pool
        .get()
        .await?
        .query_one(
            "SELECT count(*) FROM relay.agent_cleanups WHERE connection_id=$1",
            &[&id],
        )
        .await?
        .get(0);
    assert_eq!(pending, 0);
    // Rotate every encrypted record class, including pending PKCE and revocation work.
    let attempt = Uuid::new_v4();
    let pending = store
        .create(attempt, &"a".repeat(64), "oauth-api", "v1", "Pending")
        .await?;
    oauth::begin(
        &store,
        &service.vault,
        service.catalog.provider("oauth-api")?,
        &pending,
        &context.session_id,
        &service.callback,
    )
    .await?;
    let rotated = crypto::Vault::from_json(&serde_json::to_vec(
        &json!({"active":"v2","keys":{"v1":STANDARD.encode([27;32]),"v2":STANDARD.encode([28;32])}}),
    )?)?;
    assert!(store.reencrypt(&rotated).await? >= 6);
    assert_eq!(store.reencrypt(&rotated).await?, 0);
    let remaining:i64=store.pool.get().await?.query_one("SELECT (SELECT count(*) FROM relay.connections WHERE credential IS NOT NULL AND credential->>'key_id'<>'v2')+(SELECT count(*) FROM relay.oauth_attempts WHERE secret->>'key_id'<>'v2')+(SELECT count(*) FROM relay.revocations WHERE credential->>'key_id'<>'v2')",&[]).await?.get(0);
    assert_eq!(remaining, 0);
    // New replicas with the retained old/new keyring process the encrypted revocation outbox.
    let queued = store
        .pool
        .get()
        .await?
        .query_one(
            "SELECT connection_id,credential FROM relay.revocations WHERE connection_id=$1 LIMIT 1",
            &[&client_id],
        )
        .await?;
    let queued_snapshot: Value = queued.get(1);
    assert!(
        !queued_snapshot
            .to_string()
            .contains("disposable application+secret")
    );
    // A new version may move every endpoint. Revocation still uses the issued token's snapshot.
    let mut changed_providers = providers.clone();
    changed_providers[0]["version"] = json!("v2");
    changed_providers[0]["authentication"]["revocationEndpoint"] =
        json!("https://unavailable.example/revoke");
    let mut rotated_service = service::Service::new(
        store.clone(),
        rotated,
        catalog::Catalog::from_json(&serde_json::to_vec(&changed_providers)?)?,
        Arc::new(authority.clone()),
        service.callback.clone(),
    );
    rotated_service.network = service.network.clone();
    let abandoned = Uuid::new_v4();
    store.pool.get().await?.execute("INSERT INTO relay.invocations(id,connection_id,operation,receipt_id,outcome,started_at) VALUES($1,$2,'write','fixture','started',clock_timestamp()-interval '3 minutes')",&[&abandoned,&mcp]).await?;
    rotated_service.maintain().await?;
    let recovered: String = store
        .pool
        .get()
        .await?
        .query_one(
            "SELECT outcome FROM relay.invocations WHERE id=$1",
            &[&abandoned],
        )
        .await?
        .get(0);
    assert_eq!(recovered, "unknown");
    assert_eq!(state.revocations.load(Ordering::SeqCst), 4);
    let queued: i64 = store
        .pool
        .get()
        .await?
        .query_one("SELECT count(*) FROM relay.revocations", &[])
        .await?
        .get(0);
    assert_eq!(queued, 0);
    // Retry the persisted encrypted task on a replica with an entirely empty catalog.
    store
        .pool
        .get()
        .await?
        .execute(
            "INSERT INTO relay.revocations(connection_id,credential) VALUES($1,$2)",
            &[&client_id, &queued_snapshot],
        )
        .await?;
    rotated_service.catalog = catalog::Catalog::from_json(b"[]")?;
    rotated_service.maintain().await?;
    assert_eq!(state.revocations.load(Ordering::SeqCst), 5);
    let pending: i64 = store
        .pool
        .get()
        .await?
        .query_one("SELECT count(*) FROM relay.revocations", &[])
        .await?
        .get(0);
    assert_eq!(pending, 0);
    // Removing a provider also cannot prevent local disconnect and durable queuing.
    let snapshot = rotated_service.vault.encrypt(
        client_id,
        &"a".repeat(64),
        "client",
        &serde_json::to_vec(&credential)?,
    )?;
    let before = store.connection(client_id).await?;
    store
        .pool
        .get()
        .await?
        .execute(
            "UPDATE relay.connections SET status='connected',credential=$1 WHERE id=$2",
            &[&serde_json::to_value(snapshot)?, &client_id],
        )
        .await?;
    rotated_service
        .handle(input(
            &context,
            json!({"action":"disconnect","id":client_id}),
        ))
        .await?;
    assert_eq!(store.connection(client_id).await?.status, "disconnected");
    assert!(store.connection(client_id).await?.credential.is_none());
    assert!(store.connection(client_id).await?.version > before.version);
    rotated_service.maintain().await?;
    assert_eq!(state.revocations.load(Ordering::SeqCst), 6);
    // Runtime credentials can use the schema but cannot alter schema or the migration ledger.
    let client = store.pool.get().await?;
    client.batch_execute("SET ROLE relay_runtime").await?;
    assert!(
        client
            .batch_execute("CREATE TABLE relay.forbidden(id integer)")
            .await
            .is_err()
    );
    assert!(
        client
            .execute("UPDATE relay.schema_version SET version=2", &[])
            .await
            .is_err()
    );
    assert!(
        client
            .query_one("SELECT count(*) FROM relay.connections", &[])
            .await
            .is_ok()
    );
    client.batch_execute("RESET ROLE").await?;
    authority.allowed.store(false, Ordering::SeqCst);
    let calls = state.calls.load(Ordering::SeqCst);
    assert!(service.handle(input(&context, call)).await.is_err());
    assert_eq!(state.calls.load(Ordering::SeqCst), calls);
    server.abort();
    Ok(())
}

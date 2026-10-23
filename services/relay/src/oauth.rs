use anyhow::{Context, Result, ensure};
use aws_lc_rs::rand::{SecureRandom, SystemRandom};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

use crate::{
    catalog::{Authentication, OAuthClientAuthentication, OAuthGrant, Provider},
    crypto::Vault,
    network::{Network, body},
    store::{Connection, Store},
};

#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Credential {
    pub access_token: String,
    pub refresh_token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revocation: Option<Revocation>,
}

/// Retained with the encrypted token, independently of catalog and secret-file changes.
#[derive(Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Revocation {
    pub endpoint: String,
    pub client_id: String,
    #[zeroize(skip)]
    pub client_authentication: OAuthClientAuthentication,
    pub client_secret: Option<String>,
}
#[derive(Serialize, Deserialize)]
struct Attempt {
    verifier: String,
    redirect_uri: String,
}

pub fn random_secret() -> Result<String> {
    let mut bytes = [0u8; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| anyhow::anyhow!("secure randomness unavailable"))?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}
pub fn hash(value: &str) -> Vec<u8> {
    Sha256::digest(value.as_bytes()).to_vec()
}

fn basic_component(value: &str) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .append_pair("", value)
        .finish()
        .trim_start_matches('=')
        .to_owned()
}

pub async fn begin(
    store: &Store,
    vault: &Vault,
    provider: &Provider,
    connection: &Connection,
    session: &str,
    redirect_uri: &str,
) -> Result<String> {
    let Authentication::OAuth2 {
        authorization_endpoint: Some(endpoint),
        client_id,
        grant: OAuthGrant::AuthorizationCode,
        scopes,
        ..
    } = &provider.authentication
    else {
        anyhow::bail!("provider does not support browser authorization");
    };
    let redirect = url::Url::parse(redirect_uri)?;
    ensure!(
        redirect.scheme() == "https"
            && redirect.query().is_none()
            && redirect.fragment().is_none()
            && redirect.username().is_empty()
            && redirect.password().is_none(),
        "invalid OAuth callback"
    );
    ensure!(
        connection.status == "pending" || connection.status == "reconnect",
        "connection is not awaiting authorization"
    );
    let state = random_secret()?;
    let verifier = random_secret()?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let attempt = Zeroizing::new(serde_json::to_vec(&Attempt {
        verifier,
        redirect_uri: redirect_uri.into(),
    })?);
    let encrypted = vault.encrypt(
        connection.id,
        &connection.owner_id,
        &format!("{}:oauth-attempt", provider.id),
        &attempt,
    )?;
    let mut client = store.pool.get().await?;
    let tx = client.transaction().await?;
    tx.execute(
        "DELETE FROM relay.oauth_attempts WHERE expires_at<clock_timestamp() OR connection_id=$1",
        &[&connection.id],
    )
    .await?;
    tx.execute("INSERT INTO relay.oauth_attempts(state_hash,connection_id,owner_id,session_hash,secret,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')", &[&hash(&state),&connection.id,&connection.owner_id,&hash(session),&serde_json::to_value(encrypted)?]).await?;
    tx.commit().await?;
    let mut url = url::Url::parse(endpoint)?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("scope", &scopes.join(" "));
    Ok(url.to_string())
}

pub struct OwnerSession<'a> {
    pub owner: &'a str,
    pub session: &'a str,
}

pub async fn finish(
    store: &Store,
    vault: &Vault,
    network: &Network,
    provider: &Provider,
    actor: OwnerSession<'_>,
    state: &str,
    code: &str,
) -> Result<Uuid> {
    let OwnerSession { owner, session } = actor;
    ensure!(
        state.len() == 43 && !code.is_empty() && code.len() <= 8192,
        "invalid OAuth callback"
    );
    let row=store.pool.get().await?.query_opt("UPDATE relay.oauth_attempts SET consumed=true WHERE state_hash=$1 AND owner_id=$2 AND session_hash=$3 AND NOT consumed AND expires_at>clock_timestamp() RETURNING connection_id,secret", &[&hash(state),&owner,&hash(session)]).await?.context("OAuth attempt expired or was already used")?;
    let id: Uuid = row.get(0);
    let connection = store.connection(id).await?;
    ensure!(
        connection.owner_id == owner
            && connection.provider_id == provider.id
            && connection.provider_version == provider.version
            && matches!(connection.status.as_str(), "pending" | "reconnect"),
        "OAuth connection changed"
    );
    let encrypted = serde_json::from_value(row.get(1))?;
    let plain = vault.decrypt(
        id,
        owner,
        &format!("{}:oauth-attempt", provider.id),
        &encrypted,
    )?;
    let attempt: Attempt = serde_json::from_slice(&plain)?;
    let mut form = vec![
        ("grant_type".into(), "authorization_code".into()),
        ("code".into(), code.into()),
        ("redirect_uri".into(), attempt.redirect_uri),
        ("code_verifier".into(), attempt.verifier),
    ];
    let token = exchange(network, provider, &mut form).await?;
    persist(store, vault, &connection, provider, token, None).await?;
    Ok(id)
}

pub async fn client_credentials(
    store: &Store,
    vault: &Vault,
    network: &Network,
    provider: &Provider,
    connection: &Connection,
) -> Result<()> {
    let Authentication::OAuth2 {
        grant: OAuthGrant::ClientCredentials,
        ..
    } = &provider.authentication
    else {
        anyhow::bail!("provider does not support client credentials");
    };
    let token = exchange(
        network,
        provider,
        &mut vec![("grant_type".into(), "client_credentials".into())],
    )
    .await?;
    persist(store, vault, connection, provider, token, None).await
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    token_type: String,
    refresh_token: Option<String>,
    expires_in: Option<u64>,
    scope: Option<String>,
    #[serde(skip)]
    revocation: Option<Revocation>,
}

async fn exchange(
    network: &Network,
    provider: &Provider,
    form: &mut Vec<(String, String)>,
) -> Result<TokenResponse> {
    let Authentication::OAuth2 {
        token_endpoint,
        client_id,
        client_secret_file,
        client_authentication,
        scopes,
        ..
    } = &provider.authentication
    else {
        anyhow::bail!("OAuth provider required");
    };
    form.push(("client_id".into(), client_id.clone()));
    let mut application_secret = None;
    let mut basic_secret = None;
    if let Some(file) = client_secret_file {
        let secret = Zeroizing::new(
            tokio::fs::read_to_string(file)
                .await
                .context("OAuth application credential unavailable")?,
        );
        ensure!(
            !secret.trim().is_empty(),
            "OAuth application credential unavailable"
        );
        application_secret = Some(Zeroizing::new(secret.trim_end().to_owned()));
        if *client_authentication == OAuthClientAuthentication::ClientSecretBasic {
            basic_secret = Some(Zeroizing::new(secret.trim_end().to_owned()));
        } else {
            form.push(("client_secret".into(), secret.trim_end().into()));
        }
    }
    let revocation = match &provider.authentication {
        Authentication::OAuth2 {
            revocation_endpoint: Some(endpoint),
            ..
        } => Some(Revocation {
            endpoint: endpoint.clone(),
            client_id: client_id.clone(),
            client_authentication: *client_authentication,
            client_secret: application_secret.as_ref().map(|secret| secret.to_string()),
        }),
        _ => None,
    };
    if !scopes.is_empty() {
        form.push(("scope".into(), scopes.join(" ")));
    }
    let client = network.client(token_endpoint).await?;
    let mut request = client
        .post(token_endpoint)
        .header("Accept", "application/json")
        .form(form);
    if let Some(secret) = basic_secret.as_ref() {
        request = request.basic_auth(
            basic_component(client_id),
            Some(basic_component(secret.as_str())),
        );
    }
    let result = request.send().await;
    for (_, value) in form.iter_mut() {
        value.zeroize();
    }
    let raw = Zeroizing::new(body(result?, 64 * 1024).await?);
    let mut response: TokenResponse = serde_json::from_slice(&raw)
        .map_err(|_| anyhow::anyhow!("invalid OAuth token response"))?;
    ensure!(
        response.token_type.eq_ignore_ascii_case("bearer")
            && valid_token(&response.access_token)
            && response
                .refresh_token
                .as_ref()
                .is_none_or(|token| valid_token(token))
            && response
                .expires_in
                .is_none_or(|seconds| seconds > 0 && seconds <= 31_536_000),
        "invalid OAuth token response"
    );
    response.revocation = revocation;
    Ok(response)
}

pub fn valid_token(value: &str) -> bool {
    !value.is_empty() && value.len() <= 16384 && !value.chars().any(char::is_control)
}

pub async fn revoke(network: &Network, credential: &Credential) -> Result<()> {
    let snapshot = credential
        .revocation
        .as_ref()
        .context("revocation configuration missing")?;
    // The endpoint and client authentication are encrypted alongside the issued token.
    // Never resolve these from the active provider catalog or a mutable secret file.
    crate::catalog::endpoint(&snapshot.endpoint)?;
    let mut form = vec![
        ("client_id".to_owned(), snapshot.client_id.clone()),
        (
            "token".into(),
            credential
                .refresh_token
                .as_ref()
                .unwrap_or(&credential.access_token)
                .clone(),
        ),
    ];
    if snapshot.client_authentication == OAuthClientAuthentication::ClientSecretPost {
        form.push((
            "client_secret".into(),
            snapshot
                .client_secret
                .as_ref()
                .context("revocation client secret missing")?
                .clone(),
        ));
    }
    let mut request = network
        .client(&snapshot.endpoint)
        .await?
        .post(&snapshot.endpoint)
        .form(&form);
    if snapshot.client_authentication == OAuthClientAuthentication::ClientSecretBasic {
        request = request.basic_auth(
            basic_component(&snapshot.client_id),
            Some(basic_component(
                snapshot
                    .client_secret
                    .as_ref()
                    .context("revocation client secret missing")?,
            )),
        );
    }
    for (_, value) in &mut form {
        value.zeroize();
    }
    ensure!(
        request.send().await?.status().is_success(),
        "provider revocation did not complete"
    );
    Ok(())
}

async fn persist(
    store: &Store,
    vault: &Vault,
    connection: &Connection,
    provider: &Provider,
    token: TokenResponse,
    old_refresh: Option<String>,
) -> Result<()> {
    let Authentication::OAuth2 {
        scopes: requested,
        grant,
        ..
    } = &provider.authentication
    else {
        anyhow::bail!("OAuth provider required");
    };
    let scopes: Vec<String> = token.scope.as_ref().map_or_else(
        || {
            if connection.status == "refreshing" && *grant == OAuthGrant::AuthorizationCode {
                connection.scopes.clone()
            } else {
                requested.clone()
            }
        },
        |scope| scope.split_whitespace().map(str::to_owned).collect(),
    );
    ensure!(
        scopes.iter().all(|scope| requested.contains(scope)),
        "provider returned unrequested OAuth scopes"
    );
    let credential = Credential {
        access_token: token.access_token,
        refresh_token: token.refresh_token.or(old_refresh),
        revocation: token.revocation,
    };
    let raw = Zeroizing::new(serde_json::to_vec(&credential)?);
    let envelope = vault.encrypt(
        connection.id,
        &connection.owner_id,
        &connection.provider_id,
        &raw,
    )?;
    let expiry: Option<DateTime<Utc>> = token
        .expires_in
        .map(|seconds| Utc::now() + Duration::seconds(seconds as i64));
    if let Err(error) = store
        .save_credentials(connection, &envelope, &scopes, expiry)
        .await
    {
        if credential.revocation.is_some() {
            // A disconnect may race an already dispatched code exchange or rotating refresh.
            // Keep every newly issued credential for revocation without restoring local access.
            store
                .pool
                .get()
                .await?
                .execute(
                    "INSERT INTO relay.revocations(connection_id,credential) SELECT id,$2 FROM relay.connections WHERE id=$1 AND status='disconnected'",
                    &[&connection.id, &serde_json::to_value(envelope)?],
                )
                .await?;
        }
        return Err(error);
    }
    Ok(())
}

pub async fn credential(
    store: &Store,
    vault: &Vault,
    network: &Network,
    provider: &Provider,
    id: Uuid,
) -> Result<(Connection, Credential)> {
    for _ in 0..100 {
        let connection = store.connection(id).await?;
        if connection.status == "refreshing" {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            continue;
        }
        ensure!(
            connection.status == "connected" && connection.provider_version == provider.version,
            "connection requires authorization"
        );
        let envelope = connection
            .credential
            .as_ref()
            .context("credential unavailable")?;
        let raw = vault.decrypt(
            connection.id,
            &connection.owner_id,
            &connection.provider_id,
            envelope,
        )?;
        let credential: Credential =
            serde_json::from_slice(&raw).context("invalid credential record")?;
        if !matches!(provider.authentication, Authentication::OAuth2 { .. })
            || connection
                .expires_at
                .is_none_or(|expiry| expiry > Utc::now() + Duration::seconds(60))
        {
            return Ok((connection, credential));
        }
        if !store.claim_refresh(&connection).await? {
            continue;
        }
        let claimed = store.connection(id).await?;
        ensure!(
            claimed.status == "refreshing" && claimed.version == connection.version + 1,
            "connection changed during refresh"
        );
        let result = async {
            let mut form = if matches!(
                provider.authentication,
                Authentication::OAuth2 {
                    grant: OAuthGrant::ClientCredentials,
                    ..
                }
            ) {
                vec![("grant_type".into(), "client_credentials".into())]
            } else {
                vec![
                    ("grant_type".into(), "refresh_token".into()),
                    (
                        "refresh_token".into(),
                        credential
                            .refresh_token
                            .as_ref()
                            .context("OAuth reconnection required")?
                            .clone(),
                    ),
                ]
            };
            let token = exchange(network, provider, &mut form).await?;
            persist(
                store,
                vault,
                &claimed,
                provider,
                token,
                credential.refresh_token.clone(),
            )
            .await
        }
        .await;
        if result.is_err() {
            store.refresh_failed(id, claimed.version).await?;
            anyhow::bail!("OAuth refresh failed; reconnect this account");
        }
    }
    anyhow::bail!("OAuth refresh is still in progress")
}

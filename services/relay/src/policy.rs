use anyhow::{Context, Result, ensure};
use async_trait::async_trait;
use hyper_util::rt::TokioIo;
use spiffe::{SpiffeId, TrustDomain, X509Source, X509Svid, x509_source::SvidPicker};
use spiffe_rustls::{LocalOnly, authorizer, mtls_client, mtls_server};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::net::TcpStream;
use tokio_rustls::TlsConnector;
use tonic::{
    Request,
    transport::{Channel, Endpoint},
};

use crate::authz_proto::{
    self as proto, Action, CheckRequest, CheckResponse, RequestContext, Resource, ResourceKind,
    authorization_service_client::AuthorizationServiceClient,
};

pub const RELAY_ID: &str = "spiffe://proompteng.ai/ns/tengri/sa/tengri-connector-broker";
pub const BFF_ID: &str = "spiffe://proompteng.ai/ns/proompteng/sa/proompteng";
pub const OFZ_ID: &str = "spiffe://proompteng.ai/ns/ofz/sa/ofz-api";

struct Picker(SpiffeId);
impl SvidPicker for Picker {
    fn pick_svid(&self, svids: &[Arc<X509Svid>]) -> Option<usize> {
        svids.iter().position(|s| s.spiffe_id() == &self.0)
    }
}

pub async fn identity() -> Result<X509Source> {
    let endpoint = std::env::var("SPIFFE_ENDPOINT_SOCKET")?;
    ensure!(
        endpoint.starts_with("unix:///") && !endpoint.contains(['?', '#', '\0']),
        "absolute SPIFFE socket required"
    );
    Ok(X509Source::builder()
        .endpoint(endpoint)
        .picker(Picker(RELAY_ID.parse()?))
        .initial_sync_timeout(Duration::from_secs(30))
        .build()
        .await?)
}
pub fn server_tls(source: X509Source) -> Result<Arc<rustls::ServerConfig>> {
    Ok(Arc::new(
        mtls_server(source)
            .authorize(authorizer::exact([BFF_ID.parse::<SpiffeId>()?])?)
            .trust_domain_policy(LocalOnly("proompteng.ai".parse()?))
            .with_alpn_protocols([b"h2".as_slice(), b"http/1.1".as_slice()])
            .build()?,
    ))
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[async_trait]
pub trait Policy: Send + Sync {
    async fn check(
        &self,
        context: &RequestContext,
        action: Action,
        kind: ResourceKind,
        id: &str,
        target: &str,
        receipt: &str,
    ) -> Result<CheckResponse>;
    async fn agent(
        &self,
        request: proto::CheckConnectorAgentRequest,
    ) -> Result<proto::CheckConnectorAgentResponse>;
}

#[derive(Clone)]
pub struct Ofz {
    rpc: AuthorizationServiceClient<Channel>,
}
impl Ofz {
    pub async fn ready(&self) -> Result<()> {
        let state = self
            .rpc
            .clone()
            .get_policy_state(request(proto::GetPolicyStateRequest {}))
            .await?
            .into_inner();
        ensure!(
            !state.fenced && state.archive_healthy && state.recovery_generation > 0,
            "Ofz is not admitting connector requests"
        );
        Ok(())
    }
    pub fn new(target: &str, source: X509Source) -> Result<Self> {
        let url = url::Url::parse(&format!("https://{target}"))?;
        ensure!(
            url.host_str()
                .is_some_and(|host| host.parse::<std::net::IpAddr>().is_err())
                && url.path() == "/"
                && url.username().is_empty()
                && url.password().is_none()
                && url.query().is_none()
                && url.fragment().is_none(),
            "fixed Ofz DNS authority required"
        );
        let domain: TrustDomain = "proompteng.ai".parse()?;
        let tls = mtls_client(source)
            .authorize(authorizer::exact([OFZ_ID.parse::<SpiffeId>()?])?)
            .trust_domain_policy(LocalOnly(domain))
            .with_alpn_protocols([b"h2".as_slice()])
            .build()?;
        let connector = TlsConnector::from(Arc::new(tls));
        let name = rustls::pki_types::ServerName::try_from(url.host_str().unwrap().to_owned())?;
        let address = format!(
            "{}:{}",
            url.host_str().unwrap(),
            url.port_or_known_default().unwrap()
        );
        let channel = Endpoint::from_shared(url.to_string())?
            .connect_timeout(Duration::from_secs(3))
            .connect_with_connector_lazy(tower::service_fn(move |_| {
                let connector = connector.clone();
                let name = name.clone();
                let address = address.clone();
                async move {
                    tokio::time::timeout(Duration::from_secs(3), async {
                        let stream = TcpStream::connect(address).await?;
                        stream.set_nodelay(true)?;
                        Ok::<_, std::io::Error>(TokioIo::new(
                            connector.connect(name, stream).await?,
                        ))
                    })
                    .await
                    .map_err(std::io::Error::other)?
                }
            }));
        Ok(Self {
            rpc: AuthorizationServiceClient::new(channel),
        })
    }
}
fn request<T>(value: T) -> Request<T> {
    let mut request = Request::new(value);
    request
        .metadata_mut()
        .insert("x-ofz-contract-version", "1".parse().unwrap());
    request.set_timeout(Duration::from_secs(25));
    request
}
pub fn validate(decision: &CheckResponse) -> Result<()> {
    ensure!(
        decision.allowed
            && decision.valid_until_unix_ms > now_ms()
            && decision.valid_until_unix_ms <= now_ms() + 2000
            && uuid::Uuid::parse_str(&decision.audit_receipt_id).is_ok()
            && !decision.revision.is_empty()
            && decision.recovery_generation > 0,
        "Ofz denied this operation or its decision expired"
    );
    Ok(())
}
#[async_trait]
impl Policy for Ofz {
    async fn check(
        &self,
        context: &RequestContext,
        action: Action,
        kind: ResourceKind,
        id: &str,
        target: &str,
        receipt: &str,
    ) -> Result<CheckResponse> {
        let decision = self
            .rpc
            .clone()
            .check(request(CheckRequest {
                context: Some(context.clone()),
                action: action as i32,
                resource: Some(Resource {
                    kind: kind as i32,
                    id: id.into(),
                }),
                target: target.into(),
                stream_receipt_id: receipt.into(),
            }))
            .await
            .map_err(anyhow::Error::new)?
            .into_inner();
        validate(&decision)?;
        Ok(decision)
    }
    async fn agent(
        &self,
        input: proto::CheckConnectorAgentRequest,
    ) -> Result<proto::CheckConnectorAgentResponse> {
        let response = self
            .rpc
            .clone()
            .check_connector_agent(request(input))
            .await
            .map_err(anyhow::Error::new)?
            .into_inner();
        validate(
            response
                .decision
                .as_ref()
                .context("agent decision missing")?,
        )?;
        Ok(response)
    }
}

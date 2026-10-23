use anyhow::{Context, Result};
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    routing::{get, post},
};
use hyper_util::{
    rt::{TokioExecutor, TokioIo},
    server::conn::auto::Builder,
    service::TowerToHyperService,
};
use relay::{
    catalog::Catalog,
    crypto::Vault,
    policy,
    service::{Input, Service},
    store::Store,
};
use serde_json::{Value, json};
use std::{sync::Arc, time::Duration};
use tokio::{net::TcpListener, sync::Semaphore};
use tokio_rustls::TlsAcceptor;

async fn request(
    State(service): State<Arc<Service>>,
    Json(input): Json<Input>,
) -> (StatusCode, Json<Value>) {
    if !dispatch_enabled(std::env::var("RELAY_DISPATCH_ENABLED").ok().as_deref()) {
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({"error":"connectors are not enabled"})),
        );
    }
    match tokio::time::timeout(Duration::from_secs(40), service.handle(input)).await {
        Ok(Ok(result)) => (StatusCode::OK, Json(result)),
        result => {
            tracing::warn!(outcome = "denied_or_failed", "connector request");
            let status = match &result {
                Err(_) => StatusCode::GATEWAY_TIMEOUT,
                Ok(Err(error)) => {
                    if let Some(status) = error.downcast_ref::<tonic::Status>() {
                        match status.code() {
                            tonic::Code::Unauthenticated => StatusCode::UNAUTHORIZED,
                            tonic::Code::PermissionDenied
                                if status.message().contains("multifactor") =>
                            {
                                StatusCode::PRECONDITION_REQUIRED
                            }
                            tonic::Code::PermissionDenied => StatusCode::FORBIDDEN,
                            tonic::Code::InvalidArgument => StatusCode::BAD_REQUEST,
                            tonic::Code::Aborted | tonic::Code::AlreadyExists => {
                                StatusCode::CONFLICT
                            }
                            _ => StatusCode::SERVICE_UNAVAILABLE,
                        }
                    } else if error.downcast_ref::<tokio_postgres::Error>().is_some()
                        || error.downcast_ref::<reqwest::Error>().is_some()
                    {
                        StatusCode::SERVICE_UNAVAILABLE
                    } else {
                        StatusCode::FORBIDDEN
                    }
                }
                _ => StatusCode::SERVICE_UNAVAILABLE,
            };
            (
                status,
                Json(
                    json!({"error":"This connector request was denied or is unavailable. Check the connection and its permissions."}),
                ),
            )
        }
    }
}

fn dispatch_enabled(value: Option<&str>) -> bool {
    value == Some("true")
}

#[tokio::main]
async fn main() -> Result<()> {
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("TLS provider initialization failed"))?;
    tracing_subscriber::fmt()
        .json()
        .with_env_filter("relay=info")
        .init();
    let mode = std::env::args().nth(1).unwrap_or_else(|| "serve".into());
    anyhow::ensure!(
        matches!(mode.as_str(), "serve" | "migrate" | "reencrypt") && std::env::args().len() <= 2,
        "expected serve, migrate or reencrypt"
    );
    let store = Store::from_environment().await?;
    if mode == "migrate" {
        store.migrate().await?;
        return Ok(());
    }
    store.verify().await?;
    let key = zeroize::Zeroizing::new(tokio::fs::read(std::env::var("RELAY_KEY_FILE")?).await?);
    let vault = Vault::from_json(&key)?;
    if mode == "reencrypt" {
        let changed = store.reencrypt(&vault).await?;
        tracing::info!(changed, "Relay credential key rotation completed");
        return Ok(());
    }
    let catalog =
        Catalog::from_json(&tokio::fs::read(std::env::var("RELAY_CATALOG_FILE")?).await?)?;
    let source = policy::identity().await?;
    let ofz = policy::Ofz::new(&std::env::var("OFZ_GRPC_ENDPOINT")?, source.clone())?;
    let callback = std::env::var("RELAY_OAUTH_CALLBACK")?;
    let service = Arc::new(Service::new(
        store.clone(),
        vault,
        catalog,
        Arc::new(ofz.clone()),
        callback,
    ));
    let health_store = store.clone();
    let health = Router::new()
        .route("/livez", get(|| async { StatusCode::OK }))
        .route(
            "/readyz",
            get(move || {
                let store = health_store.clone();
                let ofz = ofz.clone();
                async move {
                    if tokio::time::timeout(Duration::from_secs(2), async {
                        store.verify().await?;
                        ofz.ready().await
                    })
                    .await
                    .is_ok_and(|r| r.is_ok())
                    {
                        StatusCode::OK
                    } else {
                        StatusCode::SERVICE_UNAVAILABLE
                    }
                }
            }),
        );
    let health_listener = TcpListener::bind("0.0.0.0:8080").await?;
    tokio::spawn(async move {
        if axum::serve(health_listener, health).await.is_err() {
            tracing::error!("Relay health server stopped");
        }
    });
    let maintenance = service.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(15));
        loop {
            interval.tick().await;
            if maintenance.maintain().await.is_err() {
                tracing::warn!("Relay refresh recovery failed");
            }
        }
    });
    let listener =
        TcpListener::bind(std::env::var("RELAY_LISTEN").unwrap_or_else(|_| "0.0.0.0:8443".into()))
            .await?;
    let acceptor = TlsAcceptor::from(policy::server_tls(source)?);
    let connections = Arc::new(Semaphore::new(128));
    let router = Router::new()
        .route("/v1/request", post(request))
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .with_state(service);
    loop {
        let (socket, _) = listener.accept().await.context("Relay listener failed")?;
        let Ok(permit) = connections.clone().try_acquire_owned() else {
            continue;
        };
        let acceptor = acceptor.clone();
        let router = router.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let Ok(Ok(stream)) =
                tokio::time::timeout(Duration::from_secs(5), acceptor.accept(socket)).await
            else {
                return;
            };
            let builder = Builder::new(TokioExecutor::new());
            let connection =
                builder.serve_connection(TokioIo::new(stream), TowerToHyperService::new(router));
            let _ = tokio::time::timeout(Duration::from_secs(120), connection).await;
        });
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn dispatch_requires_exact_opt_in() {
        for value in [
            None,
            Some(""),
            Some("false"),
            Some("1"),
            Some("TRUE"),
            Some("true "),
        ] {
            assert!(!super::dispatch_enabled(value));
        }
        assert!(super::dispatch_enabled(Some("true")));
    }
}

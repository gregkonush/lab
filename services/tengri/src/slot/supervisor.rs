use std::{env, path::Path, sync::Arc};

use anyhow::Context;
use axum::{
    Json, Router,
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    response::Response,
    routing::{get, post},
};
use futures::StreamExt;
use hyper_util::{
    rt::{TokioExecutor, TokioIo},
    server::conn::auto::Builder,
    service::TowerToHyperService,
};
use tokio::{
    net::TcpListener,
    sync::{Mutex, watch},
};

use super::{
    Claim, GUEST_API_PORT, SlotState,
    runner::{self, CommandRequest, SlotStatus},
    vmm::connect_vsock,
};

pub const CLAIM_UID_HEADER: &str = "x-tengri-microvm-uid";
pub const CLAIM_EPOCH_HEADER: &str = "x-tengri-claim-epoch";

#[derive(Clone)]
struct Supervisor {
    state: watch::Sender<SlotState>,
    gate: Arc<Mutex<()>>,
    grpc: Arc<Mutex<Option<GuestConnection>>>,
    fences: watch::Sender<()>,
}

struct GuestConnection {
    claim: Claim,
    fence: watch::Receiver<()>,
    sender: hyper::client::conn::http2::SendRequest<Body>,
}

impl Supervisor {
    async fn grpc_sender(
        &self,
        claim: &Claim,
        socket: &Path,
    ) -> anyhow::Result<hyper::client::conn::http2::SendRequest<Body>> {
        let mut cached = self.grpc.lock().await;
        if let Some(connection) = cached.as_ref().filter(|connection| {
            connection.claim == *claim
                && !connection.sender.is_closed()
                && !connection.fence.has_changed().unwrap_or(true)
        }) {
            return Ok(connection.sender.clone());
        }
        let stream = connect_vsock(socket, GUEST_API_PORT).await?;
        // Hyper's HTTP/2 driver owns a background task. Dropping its connection
        // future alone does not close streams held by cloned senders.
        let stream = stream.into_std()?;
        let fence_socket = stream.try_clone()?;
        let stream = tokio::net::UnixStream::from_std(stream)?;
        let (sender, connection) =
            hyper::client::conn::http2::handshake(TokioExecutor::new(), TokioIo::new(stream))
                .await?;
        let mut state = self.state.subscribe();
        let fence = self.fences.subscribe();
        let mut lifetime = fence.clone();
        let expected = claim.clone();
        tokio::spawn(async move {
            tokio::pin!(connection);
            tokio::select! {
                _ = &mut connection => {},
                _ = state.wait_for(|state| !state.serves(&expected)) => {},
                _ = lifetime.changed() => {},
            }
            let _ = fence_socket.shutdown(std::net::Shutdown::Both);
        });
        *cached = Some(GuestConnection {
            claim: claim.clone(),
            fence,
            sender: sender.clone(),
        });
        Ok(sender)
    }

    fn fence(
        &self,
        current: &SlotState,
        request: &CommandRequest,
    ) -> Result<(), (StatusCode, String)> {
        let (claim, allowed, next) = match request {
            CommandRequest::Sleep { claim } => (
                claim,
                matches!(current, SlotState::Vacant { .. })
                    || current.serves(claim)
                    || matches!(current, SlotState::Sleeping { claim: owner, .. } | SlotState::Saving { claim: owner } if owner == claim),
                SlotState::Saving {
                    claim: claim.clone(),
                },
            ),
            CommandRequest::Stop { claim } => (
                claim,
                current.claim() == Some(claim)
                    || matches!(
                        current,
                        SlotState::Vacant { .. } | SlotState::Failed { claim: None, .. }
                    ),
                SlotState::Stopping {
                    claim: claim.clone(),
                },
            ),
            _ => return Err(busy()),
        };
        claim
            .validate()
            .map_err(|error| (StatusCode::BAD_REQUEST, error.to_string()))?;
        if !allowed {
            return Err((
                StatusCode::CONFLICT,
                "slot owner, epoch, or lifecycle changed".into(),
            ));
        }
        self.fences.send_replace(());
        self.state.send_replace(next);
        Ok(())
    }
}

pub async fn run() -> anyhow::Result<()> {
    let namespace = env::var("TENGRI_NAMESPACE")?;
    let pod_uid = env::var("TENGRI_POD_UID")?;
    let identity = crate::identity::WorkloadIdentity::for_slot(&namespace, &pod_uid).await?;
    let tls = identity.slot_server_tls(&namespace)?;
    let health = Router::new()
        .route(
            "/metrics",
            get(|| async {
                (
                    [(
                        axum::http::header::CONTENT_TYPE,
                        "text/plain; version=0.0.4; charset=utf-8",
                    )],
                    crate::metrics::global().render_latencies(),
                )
            }),
        )
        .route("/livez", get(|| async { StatusCode::OK }))
        .route(
            "/readyz",
            get(|| async {
                match runner::command(&CommandRequest::Status).await {
                    Ok(status)
                        if matches!(
                            status.state,
                            SlotState::Vacant { .. }
                                | SlotState::Awake { .. }
                                | SlotState::Sleeping { .. }
                        ) =>
                    {
                        StatusCode::OK
                    }
                    _ => StatusCode::SERVICE_UNAVAILABLE,
                }
            }),
        );
    let health_listener = TcpListener::bind("0.0.0.0:8080").await?;
    let health_task = tokio::spawn(async move { axum::serve(health_listener, health).await });
    let listener = TcpListener::bind("0.0.0.0:8443").await?;
    tokio::select! {
        result = serve(listener, tls) => result,
        result = health_task => { result??; anyhow::bail!("supervisor health listener stopped") },
    }
}

pub(super) async fn serve(
    listener: TcpListener,
    tls: Arc<rustls::ServerConfig>,
) -> anyhow::Result<()> {
    let (state, _) = watch::channel(SlotState::Preparing);
    let supervisor = Supervisor {
        state,
        gate: Arc::new(Mutex::new(())),
        grpc: Default::default(),
        fences: watch::channel(()).0,
    };
    let router = Router::new()
        .route("/slot/status", get(status))
        .route("/slot/restore", post(restore))
        .route("/slot/sleep", post(sleep))
        .route("/slot/stop", post(stop))
        .fallback(forward)
        .with_state(supervisor);
    let incoming = crate::identity::tls_incoming(listener, tls);
    tokio::pin!(incoming);
    while let Some(connection) = incoming.next().await {
        let connection = connection?;
        let service = TowerToHyperService::new(router.clone());
        tokio::spawn(async move {
            let builder = Builder::new(TokioExecutor::new());
            if let Err(error) = builder
                .serve_connection_with_upgrades(TokioIo::new(connection), service)
                .await
            {
                tracing::debug!(error = %error, "supervisor connection closed");
            }
        });
    }
    Ok(())
}

async fn status(
    State(supervisor): State<Supervisor>,
) -> Result<Json<SlotStatus>, (StatusCode, String)> {
    let _guard = supervisor.gate.lock().await;
    let status = runner::command(&CommandRequest::Status)
        .await
        .map_err(lifecycle_error)?;
    supervisor.state.send_replace(status.state.clone());
    Ok(Json(status))
}

async fn restore(
    State(supervisor): State<Supervisor>,
    Json(claim): Json<Claim>,
) -> Result<Json<SlotStatus>, (StatusCode, String)> {
    lifecycle(&supervisor, &CommandRequest::Restore { claim }).await
}

async fn sleep(
    State(supervisor): State<Supervisor>,
    Json(claim): Json<Claim>,
) -> Result<Json<SlotStatus>, (StatusCode, String)> {
    lifecycle(&supervisor, &CommandRequest::Sleep { claim }).await
}

async fn stop(
    State(supervisor): State<Supervisor>,
    Json(claim): Json<Claim>,
) -> Result<Json<SlotStatus>, (StatusCode, String)> {
    lifecycle(&supervisor, &CommandRequest::Stop { claim }).await
}

async fn lifecycle(
    supervisor: &Supervisor,
    request: &CommandRequest,
) -> Result<Json<SlotStatus>, (StatusCode, String)> {
    let _guard = supervisor.gate.lock().await;
    if matches!(
        request,
        CommandRequest::Sleep { .. } | CommandRequest::Stop { .. }
    ) {
        let current = runner::command(&CommandRequest::Status)
            .await
            .map_err(lifecycle_error)?;
        supervisor.fence(&current.state, request)?;
    }
    let result = runner::command(request).await;
    let status = match result {
        Ok(status) => status,
        Err(error) => {
            if let Ok(status) = runner::command(&CommandRequest::Status).await {
                supervisor.state.send_replace(status.state);
            }
            return Err(lifecycle_error(error));
        }
    };
    supervisor.state.send_replace(status.state.clone());
    Ok(Json(status))
}

fn lifecycle_error(error: anyhow::Error) -> (StatusCode, String) {
    (StatusCode::SERVICE_UNAVAILABLE, error.to_string())
}

fn busy() -> (StatusCode, String) {
    (StatusCode::CONFLICT, "slot lifecycle is busy".into())
}

async fn forward(
    State(supervisor): State<Supervisor>,
    mut request: Request<Body>,
) -> Result<Response, (StatusCode, String)> {
    let admission =
        crate::metrics::global().latency_timer(crate::metrics::Latency::SupervisorAdmission);
    #[cfg(test)]
    let started = std::time::Instant::now();
    // The status read and transport admission cannot overlap a sleep fence.
    let guard = supervisor.gate.lock().await;
    let status = runner::command(&CommandRequest::Status)
        .await
        .map_err(lifecycle_error)?;
    let claim = status
        .state
        .claim()
        .context("slot is unclaimed")
        .map_err(lifecycle_error)?
        .clone();
    if !status.state.serves(&claim)
        || request
            .headers()
            .get(CLAIM_UID_HEADER)
            .and_then(|v| v.to_str().ok())
            != Some(claim.microvm_uid.as_str())
        || request
            .headers()
            .get(CLAIM_EPOCH_HEADER)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok())
            != Some(claim.epoch)
    {
        return Err((
            StatusCode::CONFLICT,
            "slot owner, epoch, or lifecycle changed".into(),
        ));
    }
    supervisor.state.send_replace(status.state);
    #[cfg(test)]
    eprintln!(
        "real KVM proxy status: {:.2} ms cumulative",
        started.elapsed().as_secs_f64() * 1000.0
    );
    let socket = runner::sockets_directory().join("guest.vsock");
    #[cfg(test)]
    eprintln!(
        "real KVM proxy vsock: {:.2} ms cumulative",
        started.elapsed().as_secs_f64() * 1000.0
    );
    let mut parts = request.uri().clone().into_parts();
    parts.scheme = Some(axum::http::uri::Scheme::HTTP);
    parts.authority = Some(axum::http::uri::Authority::from_static("nanoagent"));
    *request.uri_mut() =
        axum::http::Uri::from_parts(parts).map_err(|error| lifecycle_error(error.into()))?;
    let grpc = request
        .headers()
        .get("content-type")
        .is_some_and(|v| v.as_bytes().starts_with(b"application/grpc"));
    if grpc {
        let mut sender = supervisor
            .grpc_sender(&claim, &socket)
            .await
            .map_err(lifecycle_error)?;
        drop(guard);
        drop(admission);
        #[cfg(test)]
        eprintln!(
            "real KVM proxy HTTP/2: {:.2} ms cumulative",
            started.elapsed().as_secs_f64() * 1000.0
        );
        let response = sender
            .send_request(request)
            .await
            .map_err(|error| lifecycle_error(error.into()))?;
        #[cfg(test)]
        eprintln!(
            "real KVM proxy reply: {:.2} ms cumulative",
            started.elapsed().as_secs_f64() * 1000.0
        );
        Ok(response.map(Body::new))
    } else {
        let mut state = supervisor.state.subscribe();
        let lifetime = supervisor.fences.subscribe();
        let mut driver_lifetime = lifetime.clone();
        let expected = claim.clone();
        let stream = connect_vsock(&socket, GUEST_API_PORT)
            .await
            .map_err(lifecycle_error)?;
        drop(guard);
        drop(admission);
        let downstream_upgrade = hyper::upgrade::on(&mut request);
        let (mut sender, connection) = hyper::client::conn::http1::handshake(TokioIo::new(stream))
            .await
            .map_err(|error| lifecycle_error(error.into()))?;
        tokio::spawn(async move {
            let connection = connection.with_upgrades();
            tokio::pin!(connection);
            tokio::select! {
                _ = &mut connection => {},
                _ = state.wait_for(|state| !state.serves(&expected)) => {},
                _ = driver_lifetime.changed() => {},
            }
        });
        let mut response = sender
            .send_request(request)
            .await
            .map_err(|error| lifecycle_error(error.into()))?;
        if response.status() == StatusCode::SWITCHING_PROTOCOLS {
            let upstream_upgrade = hyper::upgrade::on(&mut response);
            let mut state = supervisor.state.subscribe();
            let mut lifetime = lifetime;
            tokio::spawn(async move {
                if let (Ok(downstream), Ok(upstream)) =
                    tokio::join!(downstream_upgrade, upstream_upgrade)
                {
                    let (mut downstream, mut upstream) =
                        (TokioIo::new(downstream), TokioIo::new(upstream));
                    tokio::select! {
                        _ = tokio::io::copy_bidirectional(&mut downstream, &mut upstream) => {},
                        _ = state.wait_for(|state| !state.serves(&claim)) => {},
                        _ = lifetime.changed() => {},
                    }
                }
            });
        }
        Ok(response.map(Body::new))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn http2_reuses_vsock_and_closes_pending_requests_at_a_sleep_fence() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let directory = std::path::PathBuf::from(format!(
            "/tmp/tengri-vsock-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir(&directory).unwrap();
        let socket = directory.join("guest.vsock");
        let listener = tokio::net::UnixListener::bind(&socket).unwrap();
        let connections = Arc::new(AtomicUsize::new(0));
        let accepts = connections.clone();
        let server = tokio::spawn(async move {
            loop {
                let (mut stream, _) = listener.accept().await.unwrap();
                accepts.fetch_add(1, Ordering::SeqCst);
                tokio::spawn(async move {
                    let mut handshake = Vec::new();
                    loop {
                        let byte = stream.read_u8().await.unwrap();
                        handshake.push(byte);
                        if byte == b'\n' {
                            break;
                        }
                    }
                    assert_eq!(handshake, b"CONNECT 1024\n");
                    stream.write_all(b"OK 1024\n").await.unwrap();
                    let service = hyper::service::service_fn(
                        |request: Request<hyper::body::Incoming>| async move {
                            if request.uri().path() == "/pending" {
                                futures::future::pending::<()>().await;
                            }
                            Ok::<_, std::convert::Infallible>(Response::new(Body::from("ok")))
                        },
                    );
                    let _ = hyper::server::conn::http2::Builder::new(TokioExecutor::new())
                        .serve_connection(TokioIo::new(stream), service)
                        .await;
                });
            }
        });
        let claim = Claim {
            microvm_id: "agent-a".into(),
            microvm_uid: "owner-a".into(),
            epoch: 7,
        };
        let (state, _) = watch::channel(SlotState::Awake {
            claim: claim.clone(),
        });
        let supervisor = Supervisor {
            state,
            gate: Default::default(),
            grpc: Default::default(),
            fences: watch::channel(()).0,
        };
        for _ in 0..4 {
            let mut sender = supervisor.grpc_sender(&claim, &socket).await.unwrap();
            assert_eq!(
                sender
                    .send_request(
                        Request::builder()
                            .uri("http://nanoagent/ok")
                            .body(Body::empty())
                            .unwrap()
                    )
                    .await
                    .unwrap()
                    .status(),
                StatusCode::OK
            );
        }
        assert_eq!(connections.load(Ordering::SeqCst), 1);
        let mut sender = supervisor.grpc_sender(&claim, &socket).await.unwrap();
        let mut pending = tokio::spawn(async move {
            sender
                .send_request(
                    Request::builder()
                        .uri("http://nanoagent/pending")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(25), &mut pending)
                .await
                .is_err()
        );
        let current = supervisor.state.borrow().clone();
        supervisor
            .fence(
                &current,
                &CommandRequest::Sleep {
                    claim: claim.clone(),
                },
            )
            .unwrap();
        supervisor.state.send_replace(SlotState::Awake {
            claim: claim.clone(),
        });
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(1), pending)
                .await
                .unwrap()
                .unwrap()
                .is_err()
        );
        supervisor.state.send_replace(SlotState::Awake {
            claim: claim.clone(),
        });
        let mut sender = supervisor.grpc_sender(&claim, &socket).await.unwrap();
        sender
            .send_request(
                Request::builder()
                    .uri("http://nanoagent/ok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(connections.load(Ordering::SeqCst), 2);
        let next = Claim { epoch: 8, ..claim };
        supervisor.state.send_replace(SlotState::Awake {
            claim: next.clone(),
        });
        let mut sender = supervisor.grpc_sender(&next, &socket).await.unwrap();
        sender
            .send_request(
                Request::builder()
                    .uri("http://nanoagent/ok")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(connections.load(Ordering::SeqCst), 3);
        server.abort();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn concurrent_guest_requests_wait_for_transport_admission() {
        let (state, _) = watch::channel(SlotState::Awake {
            claim: Claim {
                microvm_id: "agent-a".into(),
                microvm_uid: "owner-a".into(),
                epoch: 7,
            },
        });
        let gate = Arc::new(Mutex::new(()));
        let _admission = gate.lock().await;
        let request = Request::builder()
            .uri("/proompteng.runtime.guest.v1.NanoagentService/GetInfo")
            .header(CLAIM_UID_HEADER, "owner-a")
            .header(CLAIM_EPOCH_HEADER, "7")
            .body(Body::empty())
            .unwrap();
        let supervisor = Supervisor {
            state,
            gate: gate.clone(),
            grpc: Default::default(),
            fences: watch::channel(()).0,
        };
        let response = forward(State(supervisor), request);
        futures::pin_mut!(response);
        assert!(futures::poll!(response).is_pending());
    }

    #[test]
    fn a_pending_sleep_commit_can_only_be_retried_by_its_owner() {
        let owner = Claim {
            microvm_id: "agent-a".into(),
            microvm_uid: "owner-a".into(),
            epoch: 7,
        };
        let saving = SlotState::Saving {
            claim: owner.clone(),
        };
        let (state, _) = watch::channel(saving.clone());
        let supervisor = Supervisor {
            state,
            gate: Arc::new(Mutex::new(())),
            grpc: Default::default(),
            fences: watch::channel(()).0,
        };
        for claim in [
            Claim {
                microvm_uid: "owner-b".into(),
                ..owner.clone()
            },
            Claim {
                epoch: 8,
                ..owner.clone()
            },
        ] {
            assert!(
                supervisor
                    .fence(&saving, &CommandRequest::Sleep { claim })
                    .is_err()
            );
        }
        supervisor
            .fence(&saving, &CommandRequest::Sleep { claim: owner })
            .unwrap();
        assert_eq!(*supervisor.state.borrow(), saving);
    }

    #[test]
    fn stale_lifecycle_requests_do_not_close_the_current_owners_streams() {
        let owner = Claim {
            microvm_id: "agent-a".into(),
            microvm_uid: "owner-a".into(),
            epoch: 7,
        };
        let awake = SlotState::Awake {
            claim: owner.clone(),
        };
        let (state, _) = watch::channel(awake.clone());
        let supervisor = Supervisor {
            state,
            gate: Arc::new(Mutex::new(())),
            grpc: Default::default(),
            fences: watch::channel(()).0,
        };
        for wrong in [
            Claim {
                microvm_uid: "owner-b".into(),
                ..owner.clone()
            },
            Claim {
                epoch: 8,
                ..owner.clone()
            },
            Claim {
                microvm_id: "".into(),
                ..owner.clone()
            },
        ] {
            for request in [
                CommandRequest::Sleep {
                    claim: wrong.clone(),
                },
                CommandRequest::Stop {
                    claim: wrong.clone(),
                },
            ] {
                assert!(supervisor.fence(&awake, &request).is_err());
                assert!(supervisor.state.borrow().serves(&owner));
            }
        }
        supervisor
            .fence(
                &awake,
                &CommandRequest::Sleep {
                    claim: owner.clone(),
                },
            )
            .unwrap();
        assert!(!supervisor.state.borrow().serves(&owner));
    }
}

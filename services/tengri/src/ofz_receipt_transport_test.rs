use super::*;
use std::{
    convert::Infallible,
    future::Future,
    pin::Pin,
    sync::atomic::{AtomicBool, Ordering},
};
use tokio::sync::Mutex;

#[derive(Clone)]
struct CheckService {
    calls: Arc<Mutex<Vec<CheckRequest>>>,
    allowed: Arc<AtomicBool>,
}

impl tonic::server::UnaryService<CheckRequest> for CheckService {
    type Response = CheckResponse;
    type Future =
        Pin<Box<dyn Future<Output = Result<tonic::Response<CheckResponse>, Status>> + Send>>;

    fn call(&mut self, request: Request<CheckRequest>) -> Self::Future {
        let service = self.clone();
        Box::pin(async move {
            let request = request.into_inner();
            let receipt = if request.stream_receipt_id.is_empty() {
                uuid::Uuid::new_v4().to_string()
            } else {
                request.stream_receipt_id.clone()
            };
            service.calls.lock().await.push(request);
            Ok(tonic::Response::new(CheckResponse {
                allowed: service.allowed.load(Ordering::SeqCst),
                revision: "fresh-policy".into(),
                audit_receipt_id: receipt,
                valid_until_unix_ms: now_ms()? + 1500,
                recovery_generation: 1,
                effective_scope: None,
            }))
        })
    }
}

#[tokio::test]
async fn repeated_reads_still_call_ofz_and_control_submissions_keep_distinct_audits() {
    crate::install_rustls_crypto_provider().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let service = CheckService {
        calls: Arc::new(Mutex::new(Vec::new())),
        allowed: Arc::new(AtomicBool::new(true)),
    };
    let incoming = service.clone();
    let server = tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let service = incoming.clone();
            tokio::spawn(async move {
                hyper::server::conn::http2::Builder::new(hyper_util::rt::TokioExecutor::new())
                    .serve_connection(
                        TokioIo::new(stream),
                        hyper::service::service_fn(move |request| {
                            let service = service.clone();
                            async move {
                                let mut grpc =
                                    tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
                                Ok::<_, Infallible>(grpc.unary(service, request).await)
                            }
                        }),
                    )
                    .await
                    .unwrap();
            });
        }
    });
    let channel = Endpoint::from_shared(format!("http://{address}"))
        .unwrap()
        .connect()
        .await
        .unwrap();
    let client = Client::from_channel(channel);
    let uid = "11111111-1111-4111-8111-111111111111";
    let context =
        crate::auth::Principal::fixture(&"a".repeat(64), uid, Action::FilesObserve).context;
    let resource = Resource {
        kind: proto::ResourceKind::Workspace as i32,
        id: uid.into(),
    };
    let results = futures::future::join_all((0..8).map(|_| {
        client.check(
            context.clone(),
            Action::FilesObserve,
            resource.clone(),
            "/workspace/file".into(),
            String::new(),
            1,
        )
    }))
    .await;
    let first = results[0].as_ref().unwrap().audit_receipt_id.clone();
    assert!(
        results
            .iter()
            .all(|r| r.as_ref().unwrap().audit_receipt_id == first)
    );
    {
        let calls = service.calls.lock().await;
        assert_eq!(
            calls.len(),
            8,
            "a receipt must never replace a fresh policy RPC"
        );
        assert_eq!(
            calls
                .iter()
                .filter(|r| r.stream_receipt_id.is_empty())
                .count(),
            1,
            "concurrent reads must establish only one durable receipt"
        );
    }
    service.allowed.store(false, Ordering::SeqCst);
    assert_eq!(
        client
            .check(
                context.clone(),
                Action::FilesObserve,
                resource.clone(),
                "/workspace/file".into(),
                String::new(),
                1
            )
            .await
            .unwrap_err()
            .code(),
        tonic::Code::PermissionDenied
    );
    assert_eq!(
        service.calls.lock().await.len(),
        9,
        "revocation must reach Ofz even with a cached receipt"
    );
    service.allowed.store(true, Ordering::SeqCst);
    let other = client
        .check(
            context.clone(),
            Action::FilesObserve,
            resource.clone(),
            "/workspace/other".into(),
            String::new(),
            1,
        )
        .await
        .unwrap();
    assert_ne!(other.audit_receipt_id, first);
    let controls = futures::future::join_all((0..4).map(|_| {
        client.check(
            context.clone(),
            Action::FilesWrite,
            resource.clone(),
            "/workspace/file".into(),
            String::new(),
            1,
        )
    }))
    .await;
    let ids: std::collections::HashSet<_> = controls
        .into_iter()
        .map(|r| r.unwrap().audit_receipt_id)
        .collect();
    assert_eq!(ids.len(), 4);
    assert!(
        service
            .calls
            .lock()
            .await
            .iter()
            .filter(|r| r.action == Action::FilesWrite as i32)
            .all(|r| r.stream_receipt_id.is_empty())
    );
    server.abort();
}

use anyhow::{Context, ensure};
use axum::{
    body::{Body, Bytes},
    http::{Method, Request},
};
use http_body_util::{BodyExt, StreamBody};
use prost::Message;
use sha2::{Digest, Sha256};
use tengri::guest_authorization::{
    GuestAction, GuestBinding, GuestContext, GuestProof, GuestVerifier, request_action, rpc_action,
};
use tracing::Instrument;

use super::Claim;
use crate::{
    control::{Database, Fence},
    guest::rpc::proto,
};

const MAX_OPENING_BYTES: usize = 10 << 20;
const MAX_PREVIEW_BYTES: usize = 32 << 20;
const MAX_BUFFERED_OPENING_BYTES: usize = 2 * MAX_PREVIEW_BYTES;

#[derive(Clone)]
pub(super) struct GuestAdmission {
    verifier: GuestVerifier,
    pod_uid: String,
    recovery_generation: u64,
    capacity: std::sync::Arc<tokio::sync::Semaphore>,
}

pub(super) struct Opening {
    context: GuestContext,
    method: String,
    target: String,
    body: Bytes,
}

impl GuestAdmission {
    pub(super) fn new(
        verifier: GuestVerifier,
        pod_uid: String,
        recovery_generation: u64,
    ) -> anyhow::Result<Self> {
        ensure!(
            crate::ofz::canonical_uuid(&pod_uid) && recovery_generation > 0,
            "guest admission requires an installed pod UID and recovery generation"
        );
        Ok(Self {
            verifier,
            pod_uid,
            recovery_generation,
            capacity: std::sync::Arc::new(tokio::sync::Semaphore::new(MAX_BUFFERED_OPENING_BYTES)),
        })
    }

    pub(super) async fn opening(
        &self,
        request: Request<Body>,
    ) -> anyhow::Result<(Opening, Request<Body>)> {
        let grpc = rpc_action(request.uri().path()).is_some();
        let method = if grpc {
            ensure!(
                request.method() == Method::POST && request.uri().query().is_none(),
                "signed guest RPC required"
            );
            ensure!(
                request.headers().get_all("content-type").iter().count() == 1
                    && request
                        .headers()
                        .get("content-type")
                        .is_some_and(|v| matches!(
                            v.as_bytes(),
                            b"application/grpc" | b"application/grpc+proto"
                        )),
                "guest RPC content type required"
            );
            ensure!(
                request.headers().get_all("grpc-encoding").iter().count() <= 1
                    && request
                        .headers()
                        .get("grpc-encoding")
                        .is_none_or(|v| v == "identity"),
                "compressed guest RPC is not admitted"
            );
            request.uri().path().to_owned()
        } else {
            ensure!(
                request.uri().path().starts_with("/v1/preview/")
                    && !request.headers().contains_key("trailer"),
                "signed guest preview required"
            );
            format!("HTTP {}", request.method())
        };
        let action = request_action(&method).context("unknown guest request")?;
        let context = self.verifier.verify(
            &GuestProof::from_headers(request.headers())?,
            crate::ofz::now_ms()?,
        )?;
        ensure!(
            context.method == method && context.action == action,
            "guest request differs from its signed method"
        );
        let remaining = context
            .deadline_unix_ms
            .saturating_sub(crate::ofz::now_ms()?)
            .min(2000);
        let (parts, source) = request.into_parts();
        let (body, forwarded) =
            tokio::time::timeout(std::time::Duration::from_millis(remaining), async {
                let permit = self
                    .capacity
                    .clone()
                    .acquire_many_owned(if grpc {
                        (MAX_OPENING_BYTES + 5) as u32
                    } else {
                        MAX_PREVIEW_BYTES as u32
                    })
                    .instrument(tracing::info_span!("guest.admission.capacity"))
                    .await
                    .context("guest admission closed")?;
                let (body, forwarded) = if grpc {
                    opening_body(source, permit).await?
                } else {
                    let body = axum::body::to_bytes(source, MAX_PREVIEW_BYTES)
                        .instrument(tracing::info_span!("guest.admission.body"))
                        .await
                        .context("preview request body exceeds its limit")?;
                    let body = retained_opening(body, permit);
                    (body.clone(), Body::from(body))
                };
                Ok::<_, anyhow::Error>((body, forwarded))
            })
            .await
            .context("guest opening deadline exceeded")??;
        let target = if grpc {
            request_target(&method, &body)?
        } else {
            parts
                .uri
                .path_and_query()
                .context("preview target missing")?
                .as_str()
                .to_owned()
        };
        Ok((
            Opening {
                context,
                method,
                target,
                body,
            },
            Request::from_parts(parts, forwarded),
        ))
    }

    fn require_binding(
        &self,
        opening: &Opening,
        claim: &Claim,
        fence: Fence,
    ) -> anyhow::Result<()> {
        opening.context.validate(crate::ofz::now_ms()?)?;
        opening.context.require_binding(&GuestBinding {
            workspace_uid: &claim.microvm_uid,
            runtime_epoch: &claim.runtime_epoch,
            slot_epoch: claim.epoch,
            pod_uid: &self.pod_uid,
            leader_owner: &fence.owner.to_string(),
            leader_generation: fence.generation as u64,
            recovery_generation: self.recovery_generation,
            action: request_action(&opening.method).context("unknown guest request")?,
            method: &opening.method,
            target: &opening.target,
            body: &opening.body,
        })?;
        ensure!(
            opening.context.observation.is_none()
                || opening.context.action == GuestAction::WorkspaceMetadataRead,
            "bounded guest content handlers are not available"
        );
        Ok(())
    }

    pub(super) async fn consume(
        &self,
        opening: &Opening,
        claim: &Claim,
        fence: Fence,
        database: &Database,
    ) -> Result<(), tonic::Status> {
        self.require_binding(opening, claim, fence)
            .map_err(|_| tonic::Status::permission_denied("invalid signed guest admission"))?;
        let nonce_hash = Sha256::digest(
            [
                b"tengri-supervisor-guest-v4\0".as_slice(),
                opening.context.nonce.as_bytes(),
            ]
            .concat(),
        );
        database
            .consume_nonce(&nonce_hash, opening.context.deadline_unix_ms as i64)
            .await
    }

    #[cfg(test)]
    pub(super) fn fixture() -> Self {
        let signer =
            tengri::guest_authorization::GuestSigner::from_seed(&std::array::from_fn::<_, 32, _>(
                |i| i as u8,
            ))
            .unwrap();
        Self::new(
            GuestVerifier::from_bytes(signer.public_key()).unwrap(),
            "33333333-3333-4333-8333-333333333333".into(),
            1,
        )
        .unwrap()
    }
}

struct BufferedOpening {
    bytes: Bytes,
    _permit: tokio::sync::OwnedSemaphorePermit,
}

impl AsRef<[u8]> for BufferedOpening {
    fn as_ref(&self) -> &[u8] {
        &self.bytes
    }
}

fn retained_opening(bytes: Bytes, mut reservation: tokio::sync::OwnedSemaphorePermit) -> Bytes {
    let permit = reservation
        .split(bytes.len())
        .expect("opening fits its reserved byte limit");
    drop(reservation);
    Bytes::from_owner(BufferedOpening {
        bytes,
        _permit: permit,
    })
}

#[tracing::instrument(name = "guest.admission.body", skip_all)]
async fn opening_body(
    mut source: Body,
    permit: tokio::sync::OwnedSemaphorePermit,
) -> anyhow::Result<(Bytes, Body)> {
    let mut prefix = Vec::with_capacity(5);
    let mut expected = None;
    let remainder;
    loop {
        let frame = source
            .frame()
            .await
            .context("guest RPC opening message missing")??;
        let mut chunk = frame
            .into_data()
            .map_err(|_| anyhow::anyhow!("guest RPC trailers precede its opening message"))?;
        loop {
            if prefix.len() == 5 && expected.is_none() {
                ensure!(prefix[0] == 0, "compressed guest RPC opening message");
                let length = u32::from_be_bytes(prefix[1..5].try_into().unwrap()) as usize;
                ensure!(
                    length <= MAX_OPENING_BYTES,
                    "guest RPC opening message exceeds its limit"
                );
                expected = Some(length + 5);
            }
            if expected == Some(prefix.len()) || chunk.is_empty() {
                break;
            }
            let needed = expected.unwrap_or(5) - prefix.len();
            let take = needed.min(chunk.len());
            prefix.extend_from_slice(&chunk[..take]);
            chunk = chunk.slice(take..);
        }
        if expected == Some(prefix.len()) {
            remainder = chunk;
            break;
        }
    }
    let prefix = retained_opening(Bytes::from(prefix), permit);
    let opening = prefix.slice(5..);
    let frames = async_stream::stream! {
        yield Ok::<_, axum::Error>(hyper::body::Frame::data(prefix));
        if !remainder.is_empty() { yield Ok(hyper::body::Frame::data(remainder)); }
        while let Some(frame) = source.frame().await {
            let failed = frame.is_err();
            yield frame;
            if failed { break; }
        }
    };
    let body = Body::new(StreamBody::new(frames));
    Ok((opening, body))
}

fn canonical<M: Message + Default>(bytes: &[u8]) -> anyhow::Result<M> {
    let value = M::decode(bytes).context("invalid guest RPC protobuf")?;
    ensure!(
        value.encode_to_vec() == bytes,
        "noncanonical guest RPC protobuf"
    );
    Ok(value)
}

fn request_target(method: &str, body: &[u8]) -> anyhow::Result<String> {
    let operation = method
        .rsplit('/')
        .next()
        .context("guest RPC method missing")?;
    Ok(match operation {
        "GetInfo" | "OpenEditor" | "OpenBrowser" | "ListTerminals" | "CodexLogin" => {
            canonical::<proto::Empty>(body)?;
            String::new()
        }
        "ListFiles" | "ReadFile" | "CreateDirectory" => canonical::<proto::Path>(body)?.path,
        "WriteFile" => canonical::<proto::FileWrite>(body)?.path,
        "MoveFile" => canonical::<proto::FileMove>(body)?.source_path,
        "DeleteFile" => canonical::<proto::FileDelete>(body)?.path,
        "SearchFiles" => canonical::<proto::FileSearch>(body)?.path,
        "WatchFiles" => canonical::<proto::FileWatch>(body)?.path,
        "TerminateTerminal" => canonical::<proto::TerminalId>(body)?.id,
        "AttachTerminal" => match canonical::<proto::TerminalInput>(body)?.action {
            Some(proto::terminal_input::Action::Attach(attach)) => attach.id,
            _ => anyhow::bail!("terminal stream must open with an attachment"),
        },
        "CreateTerminal" => {
            canonical::<proto::TerminalCreate>(body)?;
            String::new()
        }
        "CodexCall" => {
            canonical::<proto::CodexRequest>(body)?;
            String::new()
        }
        "ResolveCodexApproval" => {
            canonical::<proto::CodexApproval>(body)?;
            String::new()
        }
        "WatchCodexEvents" => {
            canonical::<proto::CodexWatch>(body)?;
            String::new()
        }
        _ => anyhow::bail!("unknown guest RPC"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tengri::guest_authorization::{
        CONTEXT_HEADER, GuestActor, GuestSigner, PROTOCOL_VERSION, SIGNATURE_HEADER, body_sha256,
    };
    use uuid::Uuid;

    fn claim() -> Claim {
        Claim {
            microvm_id: "fixture".into(),
            microvm_uid: "11111111-1111-4111-8111-111111111111".into(),
            epoch: 7,
            runtime_epoch: "22222222-2222-4222-8222-222222222222".into(),
        }
    }

    fn fence() -> Fence {
        Fence {
            owner: Uuid::parse_str("55555555-5555-4555-8555-555555555555").unwrap(),
            generation: 2,
        }
    }

    fn signed(method: &str, target: &str, body: &[u8]) -> Request<Body> {
        let now = crate::ofz::now_ms().unwrap();
        let context = GuestContext {
            protocol_version: PROTOCOL_VERSION,
            actor: GuestActor::Human {
                subject: "a".repeat(64),
                session_id: Uuid::new_v4().to_string(),
            },
            action: request_action(method).unwrap(),
            workspace_uid: claim().microvm_uid,
            runtime_epoch: claim().runtime_epoch,
            slot_epoch: claim().epoch,
            pod_uid: GuestAdmission::fixture().pod_uid,
            leader_owner: fence().owner.to_string(),
            leader_generation: fence().generation as u64,
            recovery_generation: 1,
            audit_receipt_id: Uuid::new_v4().to_string(),
            method: method.into(),
            target: target.into(),
            body_sha256: body_sha256(body),
            issued_at_unix_ms: now,
            deadline_unix_ms: now + 2000,
            nonce: Uuid::new_v4().to_string(),
            observation: None,
        };
        let signer = GuestSigner::from_seed(&std::array::from_fn::<_, 32, _>(|i| i as u8)).unwrap();
        let proof = signer.sign(&context, now).unwrap();
        Request::builder()
            .method(if rpc_action(method).is_some() {
                Method::POST
            } else {
                method.strip_prefix("HTTP ").unwrap().parse().unwrap()
            })
            .uri(if rpc_action(method).is_some() {
                method
            } else {
                target
            })
            .header("content-type", "application/grpc")
            .header(CONTEXT_HEADER, proof.context)
            .header(SIGNATURE_HEADER, proof.signature)
            .body(Body::from(if rpc_action(method).is_some() {
                framed(body)
            } else {
                body.to_vec()
            }))
            .unwrap()
    }

    fn framed(body: &[u8]) -> Vec<u8> {
        let mut value = vec![0];
        value.extend_from_slice(&(body.len() as u32).to_be_bytes());
        value.extend_from_slice(body);
        value
    }

    const READ: &str = "/proompteng.runtime.guest.v1.NanoagentService/ReadFile";

    #[tokio::test]
    async fn supervisor_binds_preview_method_path_query_and_body_before_forwarding() {
        let admission = GuestAdmission::fixture();
        let target = "/v1/preview/43210/submit?mode=full";
        for method in [
            "HTTP GET",
            "HTTP HEAD",
            "HTTP POST",
            "HTTP PUT",
            "HTTP PATCH",
            "HTTP DELETE",
            "HTTP OPTIONS",
        ] {
            let (opening, request) = admission
                .opening(signed(method, target, b"actual body"))
                .await
                .unwrap();
            admission
                .require_binding(&opening, &claim(), fence())
                .unwrap();
            assert_eq!(
                request
                    .into_body()
                    .collect()
                    .await
                    .unwrap()
                    .to_bytes()
                    .as_ref(),
                b"actual body"
            );
        }
        let mut request = signed("HTTP POST", target, b"actual body");
        *request.uri_mut() = "/v1/preview/43210/submit?mode=other".parse().unwrap();
        let (opening, _) = admission.opening(request).await.unwrap();
        assert!(
            admission
                .require_binding(&opening, &claim(), fence())
                .is_err()
        );
        let mut request = signed("HTTP POST", target, b"actual body");
        *request.body_mut() = Body::from("changed body");
        let (opening, _) = admission.opening(request).await.unwrap();
        assert!(
            admission
                .require_binding(&opening, &claim(), fence())
                .is_err()
        );
    }

    #[tokio::test]
    async fn supervisor_binds_the_actual_body_target_claim_fence_and_recovery_generation() {
        let admission = GuestAdmission::fixture();
        let body = proto::Path {
            path: "/workspace/a".into(),
        }
        .encode_to_vec();
        let (mut opening, _) = admission
            .opening(signed(READ, "/workspace/a", &body))
            .await
            .unwrap();
        admission
            .require_binding(&opening, &claim(), fence())
            .unwrap();
        for field in [
            "workspace",
            "runtime",
            "pod",
            "slot",
            "leader",
            "generation",
            "recovery",
            "target",
            "body",
        ] {
            let before = serde_json::to_value(&opening.context).unwrap();
            match field {
                "workspace" => opening.context.workspace_uid = Uuid::new_v4().to_string(),
                "runtime" => opening.context.runtime_epoch = Uuid::new_v4().to_string(),
                "pod" => opening.context.pod_uid = Uuid::new_v4().to_string(),
                "slot" => opening.context.slot_epoch += 1,
                "leader" => opening.context.leader_owner = Uuid::new_v4().to_string(),
                "generation" => opening.context.leader_generation += 1,
                "recovery" => opening.context.recovery_generation += 1,
                "target" => opening.context.target = "/workspace/b".into(),
                "body" => opening.context.body_sha256 = body_sha256(b"different request"),
                _ => unreachable!(),
            }
            assert!(
                admission
                    .require_binding(&opening, &claim(), fence())
                    .is_err(),
                "{field}"
            );
            opening.context = serde_json::from_value(before).unwrap();
        }
        opening.context.deadline_unix_ms = crate::ofz::now_ms().unwrap();
        assert!(
            admission
                .require_binding(&opening, &claim(), fence())
                .is_err()
        );
    }

    #[tokio::test]
    async fn supervisor_rejects_unsigned_tampered_duplicate_compressed_and_noncanonical_openings() {
        let admission = GuestAdmission::fixture();
        let body = proto::Path {
            path: "/workspace/a".into(),
        }
        .encode_to_vec();
        let mut unsigned = signed(READ, "/workspace/a", &body);
        unsigned.headers_mut().remove(SIGNATURE_HEADER);
        assert!(admission.opening(unsigned).await.is_err());
        let mut tampered = signed(READ, "/workspace/a", &body);
        tampered
            .headers_mut()
            .insert(SIGNATURE_HEADER, "A".repeat(86).parse().unwrap());
        assert!(admission.opening(tampered).await.is_err());
        for header in [CONTEXT_HEADER, SIGNATURE_HEADER, "content-type"] {
            let mut duplicate = signed(READ, "/workspace/a", &body);
            let value = duplicate.headers()[header].clone();
            duplicate.headers_mut().append(header, value);
            assert!(admission.opening(duplicate).await.is_err());
        }
        let mut compressed = signed(READ, "/workspace/a", &body);
        compressed
            .headers_mut()
            .insert("grpc-encoding", "gzip".parse().unwrap());
        assert!(admission.opening(compressed).await.is_err());
        let mut duplicate_fields = body.clone();
        duplicate_fields.extend_from_slice(&body);
        assert!(
            admission
                .opening(signed(READ, "/workspace/a", &duplicate_fields))
                .await
                .is_err()
        );
        let mut wrong_method = signed(READ, "/workspace/a", &body);
        *wrong_method.uri_mut() = "/proompteng.runtime.guest.v1.NanoagentService/DeleteFile"
            .parse()
            .unwrap();
        assert!(admission.opening(wrong_method).await.is_err());
        let mut changed = signed(READ, "/workspace/a", &body);
        *changed.body_mut() = Body::from(framed(
            &proto::Path {
                path: "/workspace/b".into(),
            }
            .encode_to_vec(),
        ));
        let (opening, _) = admission.opening(changed).await.unwrap();
        assert!(
            admission
                .require_binding(&opening, &claim(), fence())
                .is_err()
        );
    }

    #[tokio::test]
    async fn open_terminal_streams_do_not_exhaust_opening_admission() {
        let admission = GuestAdmission::fixture();
        let method = "/proompteng.runtime.guest.v1.NanoagentService/AttachTerminal";
        let mut streams = Vec::new();
        for id in ["terminal-a", "terminal-b"] {
            let body = proto::TerminalInput {
                action: Some(proto::terminal_input::Action::Attach(
                    proto::TerminalAttach {
                        id: id.into(),
                        ..Default::default()
                    },
                )),
            }
            .encode_to_vec();
            let mut request = signed(method, id, &body);
            let frames = futures::StreamExt::chain(
                futures::stream::iter([Ok::<_, std::io::Error>(hyper::body::Frame::data(
                    Bytes::from(framed(&body)),
                ))]),
                futures::stream::pending(),
            );
            *request.body_mut() = Body::new(StreamBody::new(frames));
            let (opening, mut forwarded) = admission.opening(request).await.unwrap();
            admission
                .require_binding(&opening, &claim(), fence())
                .unwrap();
            drop(opening);
            let frame = forwarded.body_mut().frame().await.unwrap().unwrap();
            assert!(!frame.into_data().unwrap().is_empty());
            streams.push(forwarded);
        }
        let body = proto::Path {
            path: "/workspace/a".into(),
        }
        .encode_to_vec();
        tokio::time::timeout(
            std::time::Duration::from_millis(250),
            admission.opening(signed(READ, "/workspace/a", &body)),
        )
        .await
        .expect("open terminal streams blocked a new signed request")
        .unwrap();
    }

    #[tokio::test]
    async fn buffered_small_requests_do_not_exhaust_opening_admission() {
        let admission = GuestAdmission::fixture();
        let body = proto::Path {
            path: "/workspace/a".into(),
        }
        .encode_to_vec();
        let mut buffered = Vec::new();
        for _ in 0..2 {
            let (opening, mut forwarded) = admission
                .opening(signed(READ, "/workspace/a", &body))
                .await
                .unwrap();
            admission
                .require_binding(&opening, &claim(), fence())
                .unwrap();
            drop(opening);
            buffered.push(
                forwarded
                    .body_mut()
                    .frame()
                    .await
                    .unwrap()
                    .unwrap()
                    .into_data()
                    .unwrap(),
            );
        }
        tokio::time::timeout(
            std::time::Duration::from_millis(250),
            admission.opening(signed(READ, "/workspace/a", &body)),
        )
        .await
        .expect("small buffered frames blocked a new signed request")
        .unwrap();
    }

    #[tokio::test]
    async fn buffered_preview_uploads_remain_bounded_until_storage_is_released() {
        let admission = GuestAdmission::fixture();
        let body = vec![b'x'; MAX_PREVIEW_BYTES];
        let mut buffered = Vec::new();
        for _ in 0..2 {
            let (opening, mut forwarded) = admission
                .opening(signed("HTTP POST", "/v1/preview/43210/submit", &body))
                .await
                .unwrap();
            admission
                .require_binding(&opening, &claim(), fence())
                .unwrap();
            drop(opening);
            buffered.push(
                forwarded
                    .body_mut()
                    .frame()
                    .await
                    .unwrap()
                    .unwrap()
                    .into_data()
                    .unwrap(),
            );
        }
        let body = proto::Path {
            path: "/workspace/a".into(),
        }
        .encode_to_vec();
        assert!(
            tokio::time::timeout(
                std::time::Duration::from_millis(20),
                admission.opening(signed(READ, "/workspace/a", &body)),
            )
            .await
            .is_err(),
            "retained uploads exceeded the total buffered byte limit"
        );
        buffered.pop();
        tokio::time::timeout(
            std::time::Duration::from_millis(250),
            admission.opening(signed(READ, "/workspace/a", &body)),
        )
        .await
        .expect("released upload storage did not restore admission capacity")
        .unwrap();
    }

    #[tokio::test]
    async fn supervisor_preserves_fragmented_opening_and_following_messages() {
        let admission = GuestAdmission::fixture();
        let body = proto::Path {
            path: "/workspace/a".into(),
        }
        .encode_to_vec();
        let mut all = framed(&body);
        all.extend_from_slice(&framed(b"following input"));
        let frames: Vec<Result<hyper::body::Frame<Bytes>, std::io::Error>> = all
            .chunks(3)
            .map(|chunk| Ok(hyper::body::Frame::data(Bytes::copy_from_slice(chunk))))
            .collect();
        let (opening, forwarded) = opening_body(
            Body::new(StreamBody::new(futures::stream::iter(frames))),
            admission
                .capacity
                .clone()
                .acquire_many_owned((MAX_OPENING_BYTES + 5) as u32)
                .await
                .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(opening, body);
        assert_eq!(forwarded.collect().await.unwrap().to_bytes().as_ref(), all);
        for invalid in [
            vec![1, 0, 0, 0, 0],
            vec![0, 255, 255, 255, 255],
            vec![0, 0, 0, 0, 1],
        ] {
            assert!(
                opening_body(
                    Body::from(invalid),
                    admission
                        .capacity
                        .clone()
                        .acquire_many_owned((MAX_OPENING_BYTES + 5) as u32)
                        .await
                        .unwrap(),
                )
                .await
                .is_err()
            );
        }
        assert!(
            opening_body(
                Body::empty(),
                admission
                    .capacity
                    .clone()
                    .acquire_many_owned((MAX_OPENING_BYTES + 5) as u32)
                    .await
                    .unwrap(),
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    #[ignore = "requires disposable shared TLS PostgreSQL from test-runtime.sh"]
    async fn runtime_shared_state_supervisor_consumes_proofs_once_across_instances() {
        let controller = Database::shared_fixture().await;
        let supervisor = Database::connect(
            &std::env::var("TENGRI_DATABASE_DSN")
                .unwrap()
                .replace("user=tengri_controller", "user=tengri_supervisor"),
            std::path::Path::new(&std::env::var("TENGRI_DATABASE_PASSWORD_FILE").unwrap()),
            std::path::Path::new(&std::env::var("TENGRI_DATABASE_CA_FILE").unwrap()),
            "tengri_supervisor",
        )
        .await
        .unwrap();
        let first = GuestAdmission::fixture();
        let second = GuestAdmission::fixture();
        let body = proto::Path {
            path: "/workspace/a".into(),
        }
        .encode_to_vec();
        let (mut opening, _) = first
            .opening(signed(READ, "/workspace/a", &body))
            .await
            .unwrap();
        opening.target = "/workspace/b".into();
        assert_eq!(
            first
                .consume(&opening, &claim(), fence(), &supervisor)
                .await
                .unwrap_err()
                .code(),
            tonic::Code::PermissionDenied
        );
        opening.target = "/workspace/a".into();
        let claim = claim();
        let (a, b) = tokio::join!(
            first.consume(&opening, &claim, fence(), &supervisor),
            second.consume(&opening, &claim, fence(), &controller)
        );
        assert_eq!(
            [a.is_ok(), b.is_ok()]
                .into_iter()
                .filter(|success| *success)
                .count(),
            1
        );
        let error = a.err().or(b.err()).unwrap();
        assert_eq!(error.code(), tonic::Code::Unauthenticated);
    }
}

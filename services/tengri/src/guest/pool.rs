use std::{
    net::{IpAddr, SocketAddr},
    sync::Arc,
    time::{Duration, Instant},
};

use kube::{Api, Client, ResourceExt};
use tokio::sync::{Mutex, OnceCell};

use super::{GUEST_API_PORT, GuestClient, GuestError};
use crate::{
    crd::{MicroVM, MicroVMPhase},
    identity::WorkloadIdentity,
    slot::Claim,
};

const MAX_CONNECTIONS: usize = 6;
const MAX_AGE: Duration = Duration::from_secs(60);

#[derive(Clone, PartialEq, Eq)]
pub(super) struct GuestTarget {
    pub claim: Claim,
    pub pod_uid: String,
    pub address: SocketAddr,
    pub slot_name: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::guest::rpc::{
        proto,
        test_server::{TestServer, TestService},
    };
    use kube::client::Body as KubeBody;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn agent() -> MicroVM {
        serde_json::from_value(json!({
            "apiVersion":"runtime.proompteng.ai/v1alpha1", "kind":"MicroVM",
            "metadata":{"name":"agent-a", "uid":"vm-a", "generation":2},
            "spec":{
                "reservationId":"77f8ce6b-18c5-4f7b-950c-b5639b70619e",
                "runtimeEpoch":"39d272fe-2781-4bc2-886c-a2993865f646", "policyVersion":1,
                "displayName":"Agent", "ownerHash":"owner", "desiredState":"Running",
                "image":"test-image", "architecture":"amd64", "resources":{"cpuMillis":4000,"memoryMib":8192,"workspaceGib":32},
                "createdAt":"2026-10-11T00:00:00Z", "idleDeadline":"2026-10-12T00:00:00Z",
                "slot":{"name":"slot-a","podUid":"pod-a","pvcName":"home-a","pvcUid":"home-uid","epoch":7}
            },
            "status":{"phase":"Ready", "guestReady":true, "podUid":"pod-a", "podIp":"127.0.0.1", "observedGeneration":2}
        })).unwrap()
    }

    #[tokio::test]
    async fn concurrent_requests_reuse_verified_connection_but_failures_and_new_claims_do_not() {
        let verifications = Arc::new(AtomicUsize::new(0));
        let calls = verifications.clone();
        let server = TestServer::start(TestService {
            get_info: Some(Arc::new(move |request| {
                assert_eq!(
                    request.metadata().get("authorization").unwrap(),
                    "Bearer fixture-token"
                );
                assert!(
                    request
                        .metadata()
                        .contains_key(crate::slot::supervisor::CLAIM_UID_HEADER)
                );
                assert!(
                    request
                        .metadata()
                        .contains_key(crate::slot::supervisor::CLAIM_EPOCH_HEADER)
                );
                if calls.fetch_add(1, Ordering::SeqCst) == 0 {
                    return Err(tonic::Status::unavailable("transient guest failure"));
                }
                Ok(proto::GuestInfo {
                    microvm_id: "pod-a".into(),
                    protocol_version: 2,
                })
            })),
            ..Default::default()
        })
        .await;
        let secrets = Arc::new(AtomicUsize::new(0));
        let secret_calls = secrets.clone();
        let service = tower::service_fn(move |request: http::Request<KubeBody>| {
            assert_eq!(
                request.uri().path(),
                "/api/v1/namespaces/tengri/secrets/slot-a-bootstrap"
            );
            secret_calls.fetch_add(1, Ordering::SeqCst);
            async {
                Ok::<_, std::convert::Infallible>(http::Response::builder().body(KubeBody::from(
                    json!({"apiVersion":"v1","kind":"Secret","immutable":true,"data":{"token":"Zml4dHVyZS10b2tlbg=="}}).to_string().into_bytes()
                )).unwrap())
            }
        });
        let port = server
            .guest
            .base_url()
            .strip_prefix("http://")
            .unwrap()
            .parse::<SocketAddr>()
            .unwrap()
            .port();
        let pool = GuestPool::new(
            Client::new(service, "tengri"),
            "tengri",
            WorkloadIdentity::Fixture(port),
        );
        let mut agent = agent();
        assert!(pool.for_microvm(&agent).await.is_err());
        let requests = futures::future::join_all((0..16).map(|_| pool.for_microvm(&agent))).await;
        assert!(requests.iter().all(Result::is_ok));
        assert_eq!(verifications.load(Ordering::SeqCst), 2);
        assert_eq!(secrets.load(Ordering::SeqCst), 2);

        agent.spec.slot.as_mut().unwrap().epoch += 1;
        pool.for_microvm(&agent).await.unwrap();
        agent.metadata.uid = Some("vm-b".into());
        pool.for_microvm(&agent).await.unwrap();
        assert_eq!(verifications.load(Ordering::SeqCst), 4);

        pool.bindings.lock().await[0].created -= MAX_AGE;
        pool.for_microvm(&agent).await.unwrap();
        assert_eq!(verifications.load(Ordering::SeqCst), 5);

        agent.status.as_mut().unwrap().phase = MicroVMPhase::Sleeping;
        assert!(matches!(
            pool.for_microvm(&agent).await,
            Err(GuestError::NotReady(_))
        ));
        agent.status.as_mut().unwrap().phase = MicroVMPhase::Ready;
        agent.status.as_mut().unwrap().pod_uid = Some("pod-b".into());
        assert!(matches!(
            pool.for_microvm(&agent).await,
            Err(GuestError::NotReady(_))
        ));
        assert_eq!(secrets.load(Ordering::SeqCst), 5);
    }
}

impl GuestTarget {
    pub fn from_microvm(
        microvm: &MicroVM,
        identity: &WorkloadIdentity,
    ) -> Result<Self, GuestError> {
        let id = microvm.name_any();
        let status = microvm
            .status
            .as_ref()
            .filter(|status| {
                microvm.metadata.deletion_timestamp.is_none()
                    && status.phase == MicroVMPhase::Ready
                    && status.guest_ready
                    && status.observed_generation >= microvm.metadata.generation.unwrap_or_default()
            })
            .ok_or_else(|| GuestError::NotReady(id.clone()))?;
        let ip: IpAddr = status
            .pod_ip
            .as_deref()
            .ok_or_else(|| GuestError::MissingGuestIp(id.clone()))?
            .parse()
            .map_err(|_| GuestError::MissingGuestIp(id.clone()))?;
        let pod_uid = status
            .pod_uid
            .as_deref()
            .filter(|uid| !uid.is_empty())
            .ok_or_else(|| GuestError::NotReady(id.clone()))?;
        let slot = microvm
            .spec
            .slot
            .as_ref()
            .filter(|slot| slot.pod_uid == pod_uid)
            .ok_or_else(|| GuestError::NotReady(id.clone()))?;
        let port = GUEST_API_PORT;
        #[cfg(test)]
        let port = match identity {
            WorkloadIdentity::Fixture(port) => *port,
            _ => port,
        };
        #[cfg(not(test))]
        let _ = identity;
        Ok(Self {
            claim: crate::slot::client::claim_for(microvm)?,
            pod_uid: pod_uid.to_owned(),
            address: SocketAddr::new(ip, port),
            slot_name: slot.name.clone(),
        })
    }
}

struct Binding {
    target: GuestTarget,
    certificate: [u8; 32],
    created: Instant,
    guest: Arc<OnceCell<GuestClient>>,
}

#[derive(Clone)]
pub struct GuestPool {
    client: Client,
    namespace: Arc<str>,
    identity: WorkloadIdentity,
    bindings: Arc<Mutex<Vec<Binding>>>,
}

impl GuestPool {
    pub fn new(client: Client, namespace: impl Into<Arc<str>>, identity: WorkloadIdentity) -> Self {
        Self {
            client,
            namespace: namespace.into(),
            identity,
            bindings: Default::default(),
        }
    }

    pub async fn for_agent(
        &self,
        id: &str,
        incarnation: Option<&str>,
    ) -> Result<GuestClient, GuestError> {
        let api: Api<MicroVM> = Api::namespaced(self.client.clone(), &self.namespace);
        let microvm = api.get(id).await?;
        if incarnation.is_some_and(|expected| microvm.metadata.uid.as_deref() != Some(expected)) {
            return Err(GuestError::Api {
                status: reqwest::StatusCode::GONE,
                message: "This editor session belongs to a previous agent. Reopen Code.".to_owned(),
            });
        }
        self.for_microvm(&microvm).await
    }

    pub async fn for_microvm(&self, microvm: &MicroVM) -> Result<GuestClient, GuestError> {
        let target = GuestTarget::from_microvm(microvm, &self.identity)?;
        let certificate = self.identity.certificate_revision()?;
        let now = Instant::now();
        let guest = {
            let mut bindings = self.bindings.lock().await;
            bindings.retain(|binding| {
                now.duration_since(binding.created) < MAX_AGE
                    && (binding.target.claim.microvm_id != target.claim.microvm_id
                        || (binding.target == target && binding.certificate == certificate))
            });
            if let Some(binding) = bindings
                .iter()
                .find(|binding| binding.target == target && binding.certificate == certificate)
            {
                binding.guest.clone()
            } else {
                if bindings.len() >= MAX_CONNECTIONS {
                    bindings.remove(0);
                }
                let guest = Arc::new(OnceCell::new());
                bindings.push(Binding {
                    target: target.clone(),
                    certificate,
                    created: now,
                    guest: guest.clone(),
                });
                guest
            }
        };
        guest
            .get_or_try_init(|| async {
                let _latency =
                    crate::metrics::global().latency_timer(crate::metrics::Latency::GuestConnect);
                GuestClient::for_target(
                    self.client.clone(),
                    &self.namespace,
                    target,
                    &self.identity,
                )
                .await
            })
            .await
            .cloned()
    }
}

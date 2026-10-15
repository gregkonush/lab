use std::{future::Future, sync::Arc, time::Duration};

use anyhow::{Context, ensure};
use k8s_openapi::{
    api::coordination::v1::{Lease, LeaseSpec},
    apimachinery::pkg::apis::meta::v1::MicroTime,
};
use kube::{
    Api, Client, ResourceExt,
    api::{ObjectMeta, PostParams},
};
use tokio::{
    sync::watch,
    time::{Instant, timeout},
};
use uuid::Uuid;

use crate::control::{Database, Fence};

const NAME: &str = "tengri-controller-leader";
const LEASE_DURATION: Duration = Duration::from_secs(15);
const RENEW_INTERVAL: Duration = Duration::from_secs(5);
const RENEW_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy)]
pub(crate) struct Authority {
    fence: Fence,
    deadline: Instant,
}

#[derive(Clone)]
pub struct Guard {
    authority: watch::Receiver<Option<Authority>>,
    fence: Fence,
}

impl Guard {
    pub fn fence(&self) -> anyhow::Result<Fence> {
        ensure!(
            self.authority
                .borrow()
                .is_some_and(|authority| authority.fence == self.fence
                    && authority.deadline > Instant::now()),
            "controller leadership expired or changed"
        );
        Ok(self.fence)
    }

    #[cfg(test)]
    pub(crate) fn fixture() -> (watch::Sender<Option<Authority>>, Self) {
        let fence = Fence {
            owner: Uuid::new_v4(),
            generation: 1,
        };
        let (sender, authority) = watch::channel(Some(Authority {
            fence,
            deadline: Instant::now() + LEASE_DURATION,
        }));
        (sender, Self { authority, fence })
    }
}

pub struct Election {
    leases: Api<Lease>,
    namespace: String,
    owner: Uuid,
    database: Arc<Database>,
    authority: watch::Sender<Option<Authority>>,
    last_observed: Option<(String, Instant)>,
}

impl Election {
    pub fn new(
        client: Client,
        namespace: String,
        owner: Uuid,
        database: Arc<Database>,
    ) -> anyhow::Result<Self> {
        ensure!(!owner.is_nil(), "controller Pod UID required");
        let (authority, _) = watch::channel(None);
        Ok(Self {
            leases: Api::namespaced(client, &namespace),
            namespace,
            owner,
            database,
            authority,
            last_observed: None,
        })
    }

    pub async fn run(mut self, context: crate::controller::ControllerContext) {
        loop {
            let acquired = timeout(RENEW_TIMEOUT, self.acquire()).await;
            let fence = match acquired {
                Ok(Ok(Some(fence))) => fence,
                Ok(Ok(None)) => {
                    tokio::time::sleep(RENEW_INTERVAL).await;
                    continue;
                }
                result => {
                    tracing::warn!(error=?result, "controller leadership acquisition failed");
                    tokio::time::sleep(RENEW_INTERVAL).await;
                    continue;
                }
            };
            let authority = Authority {
                fence,
                deadline: Instant::now() + LEASE_DURATION - RENEW_TIMEOUT,
            };
            self.authority.send_replace(Some(authority));
            let guard = Guard {
                authority: self.authority.subscribe(),
                fence,
            };
            tracing::info!(
                generation = fence.generation,
                "controller leadership acquired"
            );
            let mut leader_context = context.clone();
            leader_context.leadership = Some(guard);
            {
                let work = crate::controller::run(leader_context);
                tokio::pin!(work);
                tokio::select! {
                    _ = &mut work => tracing::warn!("controller work ended"),
                    result = renew_authority(&self.authority, authority, || self.renew(fence)) => {
                        if let Err(error) = result {
                            tracing::warn!(error = %error, "controller leadership renewal failed");
                        }
                    }
                }
                self.authority.send_replace(None);
            }
            // Admission closes before releasing shared authority. A crashed
            // process cannot release it; the SQL deadline and Lease observation bound takeover.
            let _ = timeout(RENEW_TIMEOUT, self.database.release(fence)).await;
            tracing::warn!(
                generation = fence.generation,
                "controller leadership relinquished"
            );
        }
    }

    async fn acquire(&mut self) -> anyhow::Result<Option<Fence>> {
        let mut lease = match self.leases.get_opt(NAME).await? {
            Some(lease) => lease,
            None => {
                let lease = Lease {
                    metadata: ObjectMeta {
                        name: Some(NAME.into()),
                        namespace: Some(self.namespace.clone()),
                        ..Default::default()
                    },
                    spec: Some(LeaseSpec {
                        lease_duration_seconds: Some(15),
                        ..Default::default()
                    }),
                };
                match self.leases.create(&PostParams::default(), &lease).await {
                    Ok(lease) => lease,
                    Err(kube::Error::Api(error)) if error.code == 409 => return Ok(None),
                    Err(error) => return Err(error.into()),
                }
            }
        };
        let version = lease
            .resource_version()
            .context("leader Lease has no version")?;
        let observed = match &self.last_observed {
            Some((previous, at)) if previous == &version => *at,
            _ => {
                let now = Instant::now();
                self.last_observed = Some((version, now));
                now
            }
        };
        let spec = lease.spec.get_or_insert_default();
        let own = spec.holder_identity.as_deref() == Some(self.owner.to_string().as_str());
        if spec.holder_identity.is_some() && !own && observed.elapsed() < LEASE_DURATION {
            return Ok(None);
        }
        spec.holder_identity = Some(self.owner.to_string());
        spec.lease_duration_seconds = Some(15);
        spec.renew_time = Some(MicroTime(k8s_openapi::jiff::Timestamp::now()));
        spec.acquire_time = Some(MicroTime(k8s_openapi::jiff::Timestamp::now()));
        spec.lease_transitions = Some(
            spec.lease_transitions
                .unwrap_or_default()
                .checked_add(1)
                .context("leader generation exhausted")?,
        );
        match self
            .leases
            .replace(NAME, &PostParams::default(), &lease)
            .await
        {
            Ok(_) => self.database.acquire(self.owner).await.map_err(Into::into),
            Err(kube::Error::Api(error)) if error.code == 409 => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    async fn renew(&self, fence: Fence) -> anyhow::Result<bool> {
        let mut lease = self.leases.get(NAME).await?;
        let spec = lease.spec.as_mut().context("leader Lease has no spec")?;
        if spec.holder_identity.as_deref() != Some(self.owner.to_string().as_str()) {
            return Ok(false);
        }
        spec.lease_duration_seconds = Some(15);
        spec.renew_time = Some(MicroTime(k8s_openapi::jiff::Timestamp::now()));
        self.leases
            .replace(NAME, &PostParams::default(), &lease)
            .await?;
        self.database.renew(fence).await.map_err(Into::into)
    }
}

async fn renew_authority<F, R>(
    sender: &watch::Sender<Option<Authority>>,
    mut authority: Authority,
    mut renew: F,
) -> anyhow::Result<()>
where
    F: FnMut() -> R,
    R: Future<Output = anyhow::Result<bool>>,
{
    let mut interval = tokio::time::interval(RENEW_INTERVAL);
    interval.tick().await;
    loop {
        let attempt = async {
            interval.tick().await;
            timeout(RENEW_TIMEOUT, renew()).await
        };
        tokio::select! {
            biased;
            _ = tokio::time::sleep_until(authority.deadline) => {
                anyhow::bail!("confirmed controller leadership expired");
            }
            result = attempt => match result {
                Ok(Ok(true)) => {
                    ensure!(authority.deadline > Instant::now(), "controller renewal arrived after expiry");
                    authority.deadline = Instant::now() + LEASE_DURATION - RENEW_TIMEOUT;
                    sender.send_replace(Some(authority));
                }
                Ok(Ok(false)) => anyhow::bail!("controller leadership ownership changed"),
                Ok(Err(error)) => return Err(error),
                Err(_) => tracing::warn!(generation = authority.fence.generation, "controller leadership renewal timed out within confirmed lease"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test(start_paused = true)]
    async fn transient_renewal_timeout_keeps_only_the_confirmed_authority() {
        let (sender, guard) = Guard::fixture();
        let original = *sender.borrow().as_ref().unwrap();
        let mut attempts = 0;
        let renewal = renew_authority(&sender, original, || {
            attempts += 1;
            let attempt = attempts;
            async move {
                if attempt == 1 {
                    std::future::pending::<()>().await;
                }
                Ok(true)
            }
        });
        tokio::pin!(renewal);
        tokio::select! {
            result = &mut renewal => panic!("unexpired leadership was discarded: {result:?}"),
            _ = tokio::time::sleep(Duration::from_secs(8)) => {}
        }
        assert_eq!(
            sender.borrow().as_ref().unwrap().deadline,
            original.deadline
        );
        assert!(guard.fence().is_ok());
        tokio::select! {
            result = &mut renewal => panic!("renewed leadership was discarded: {result:?}"),
            _ = tokio::time::sleep(Duration::from_secs(3)) => {}
        }
        assert!(sender.borrow().as_ref().unwrap().deadline > original.deadline);
    }

    #[tokio::test(start_paused = true)]
    async fn failed_renewals_end_at_the_confirmed_deadline() {
        let (sender, guard) = Guard::fixture();
        let authority = *sender.borrow().as_ref().unwrap();
        let begun = Instant::now();
        let result = renew_authority(&sender, authority, || {
            std::future::pending::<anyhow::Result<bool>>()
        })
        .await;
        assert!(result.is_err());
        assert_eq!(Instant::now() - begun, LEASE_DURATION);
        assert!(guard.fence().is_err());
        assert_eq!(
            sender.borrow().as_ref().unwrap().deadline,
            authority.deadline
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_late_renewal_never_extends_expired_authority() {
        let (sender, guard) = Guard::fixture();
        let authority = Authority {
            deadline: Instant::now() + Duration::from_secs(6),
            ..*sender.borrow().as_ref().unwrap()
        };
        sender.send_replace(Some(authority));
        let begun = Instant::now();
        let result = timeout(
            Duration::from_secs(7),
            renew_authority(&sender, authority, || async {
                tokio::time::sleep(Duration::from_millis(1500)).await;
                Ok(true)
            }),
        )
        .await
        .expect("expired authority kept renewing");
        assert!(result.is_err());
        assert_eq!(Instant::now() - begun, Duration::from_secs(6));
        assert!(guard.fence().is_err());
        assert_eq!(
            sender.borrow().as_ref().unwrap().deadline,
            authority.deadline
        );
    }

    #[tokio::test(start_paused = true)]
    async fn known_ownership_loss_and_errors_close_without_retry() {
        for lost in [true, false] {
            let (sender, _) = Guard::fixture();
            let authority = *sender.borrow().as_ref().unwrap();
            let begun = Instant::now();
            let mut attempts = 0;
            let result = renew_authority(&sender, authority, || {
                attempts += 1;
                async move {
                    if lost {
                        Ok(false)
                    } else {
                        anyhow::bail!("renewal was denied")
                    }
                }
            })
            .await;
            assert!(result.is_err());
            assert_eq!(attempts, 1);
            assert_eq!(Instant::now() - begun, RENEW_INTERVAL);
        }
    }

    #[tokio::test]
    async fn lost_or_replaced_authority_closes_old_guards() {
        let (authority, guard) = Guard::fixture();
        let first = guard.fence().unwrap();
        authority.send_replace(Some(Authority {
            fence: Fence {
                generation: first.generation + 1,
                ..first
            },
            deadline: Instant::now() + LEASE_DURATION,
        }));
        assert!(guard.fence().is_err());
        authority.send_replace(None);
        assert!(guard.fence().is_err());
    }

    #[tokio::test]
    async fn local_deadline_fences_even_before_next_renewal() {
        let (authority, guard) = Guard::fixture();
        let fence = guard.fence().unwrap();
        authority.send_replace(Some(Authority {
            fence,
            deadline: Instant::now() - Duration::from_millis(1),
        }));
        assert!(guard.fence().is_err());
    }
}

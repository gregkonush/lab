use std::time::Duration;

use deadpool_postgres::Pool;
use tokio::sync::{OnceCell, mpsc, oneshot};
use tonic::Status;
use tracing::Instrument;

type Outcome = Result<(), Status>;

struct Submission {
    key: Vec<u8>,
    expires_at_ms: i64,
    response: oneshot::Sender<Outcome>,
    span: tracing::Span,
}

pub(super) struct NonceWriter {
    pool: Pool,
    sender: OnceCell<mpsc::Sender<Submission>>,
}

impl NonceWriter {
    pub(super) fn new(pool: Pool) -> Self {
        Self {
            pool,
            sender: OnceCell::new(),
        }
    }

    pub(super) async fn consume(&self, key: &[u8], expires_at_ms: i64) -> Outcome {
        let sender = self
            .sender
            .get_or_init(|| async {
                let (sender, receiver) = mpsc::channel(128);
                tokio::spawn(run(self.pool.clone(), receiver));
                sender
            })
            .await;
        let (response, result) = oneshot::channel();
        sender
            .try_send(Submission {
                key: key.to_vec(),
                expires_at_ms,
                response,
                span: tracing::Span::current(),
            })
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => {
                    Status::resource_exhausted("runtime nonce queue full")
                }
                mpsc::error::TrySendError::Closed(_) => {
                    Status::unavailable("runtime nonce writer unavailable")
                }
            })?;
        result
            .await
            .map_err(|_| Status::unavailable("runtime nonce writer unavailable"))?
    }
}

async fn run(pool: Pool, mut receiver: mpsc::Receiver<Submission>) {
    while let Some(first) = receiver.recv().await {
        let mut batch = vec![first];
        let flush = tokio::time::sleep(Duration::from_millis(5));
        tokio::pin!(flush);
        while batch.len() < 32 {
            tokio::select! {
                biased;
                _ = &mut flush => break,
                next = receiver.recv() => match next {
                    Some(next) => batch.push(next),
                    None => break,
                }
            }
        }
        let result = commit(&pool, &batch)
            .instrument(batch[0].span.clone())
            .await;
        match result {
            Ok(outcomes) => {
                for (submission, outcome) in batch.into_iter().zip(outcomes) {
                    let _ = submission.response.send(outcome);
                }
            }
            Err(error) => {
                for submission in batch {
                    let _ = submission.response.send(Err(error.clone()));
                }
            }
        }
    }
}

async fn commit(pool: &Pool, batch: &[Submission]) -> Result<Vec<Outcome>, Status> {
    let mut client = pool
        .get()
        .await
        .map_err(|_| Status::unavailable("runtime nonce database unavailable"))?;
    let mut transaction = client.transaction().await.map_err(super::sql_error)?;
    let mut outcomes = Vec::with_capacity(batch.len());
    for submission in batch {
        let savepoint = transaction.transaction().await.map_err(super::sql_error)?;
        let outcome = async {
            let consumed: bool = savepoint
                .query_one(
                    "SELECT tengri.consume_nonce($1,$2)",
                    &[&submission.key, &submission.expires_at_ms],
                )
                .await
                .map_err(super::sql_error)?
                .get(0);
            if !consumed {
                return Err(Status::unauthenticated("request nonce already used"));
            }
            Ok(())
        }
        .instrument(submission.span.clone())
        .await;
        match &outcome {
            Ok(()) => savepoint.commit().await.map_err(super::sql_error)?,
            Err(_) => savepoint.rollback().await.map_err(super::sql_error)?,
        }
        outcomes.push(outcome);
    }
    transaction
        .commit()
        .instrument(tracing::info_span!(
            "db.nonce.batch.commit",
            batch_size = batch.len()
        ))
        .await
        .map_err(super::sql_error)?;
    Ok(outcomes)
}

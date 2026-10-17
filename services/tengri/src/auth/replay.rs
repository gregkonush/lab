use std::collections::HashMap;

use tokio::sync::Mutex;
use tonic::Status;

const BUCKETS: usize = 64;
const CAPACITY_PER_BUCKET: usize = 128;

pub(super) struct Window {
    buckets: [Mutex<HashMap<[u8; 32], u64>>; BUCKETS],
}

impl Default for Window {
    fn default() -> Self {
        Self {
            buckets: std::array::from_fn(|_| Mutex::new(HashMap::new())),
        }
    }
}

impl Window {
    pub(super) async fn consume(&self, nonce: [u8; 32], deadline: u64) -> Result<(), Status> {
        let mut bucket = self.buckets[nonce[0] as usize % BUCKETS].lock().await;
        let now = crate::ofz::now_ms()?;
        if deadline <= now || deadline > now + 5000 {
            return Err(Status::unauthenticated("request nonce deadline expired"));
        }
        bucket.retain(|_, expires| *expires > now);
        if bucket.contains_key(&nonce) {
            return Err(Status::unauthenticated("request nonce already used"));
        }
        if bucket.len() == CAPACITY_PER_BUCKET {
            return Err(Status::resource_exhausted("request replay window full"));
        }
        bucket.insert(nonce, deadline);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn simultaneous_replay_has_one_winner_and_live_entries_are_never_evicted() {
        let window = Window::default();
        let deadline = crate::ofz::now_ms().unwrap() + 5000;
        let results =
            futures::future::join_all((0..64).map(|_| window.consume([0; 32], deadline))).await;
        assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
        assert!(
            results
                .iter()
                .filter_map(|r| r.as_ref().err())
                .all(|e| e.code() == tonic::Code::Unauthenticated)
        );
        for n in 1..CAPACITY_PER_BUCKET {
            let mut nonce = [0; 32];
            nonce[1] = n as u8;
            window.consume(nonce, deadline).await.unwrap();
        }
        let mut overflow = [0; 32];
        overflow[2] = 1;
        assert_eq!(
            window.consume(overflow, deadline).await.unwrap_err().code(),
            tonic::Code::ResourceExhausted
        );
        assert_eq!(
            window.consume([0; 32], deadline).await.unwrap_err().code(),
            tonic::Code::Unauthenticated
        );
        let mut expired = [0; 32];
        expired[0] = 1;
        assert_eq!(
            window
                .consume(expired, crate::ofz::now_ms().unwrap())
                .await
                .unwrap_err()
                .code(),
            tonic::Code::Unauthenticated
        );
    }
}

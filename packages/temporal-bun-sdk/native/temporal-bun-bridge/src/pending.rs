use std::sync::mpsc::{Receiver, TryRecvError};
use std::sync::Mutex;
use std::vec::Vec;

#[repr(C)]
pub struct PendingResult<T> {
    receiver: Mutex<Option<Receiver<Result<T, String>>>>,
    result: Mutex<Option<Result<T, String>>>,
}

#[derive(Debug)]
pub enum PendingState {
    Pending,
    ReadyOk,
    ReadyErr(String),
}

impl<T> PendingResult<T> {
    pub fn new(receiver: Receiver<Result<T, String>>) -> Self {
        Self {
            receiver: Mutex::new(Some(receiver)),
            result: Mutex::new(None),
        }
    }

    pub fn poll(&self) -> PendingState {
        {
            let result = self.result.lock().unwrap();
            if let Some(Ok(_)) = result.as_ref() {
                return PendingState::ReadyOk;
            }
            if let Some(Err(err)) = result.as_ref() {
                return PendingState::ReadyErr(err.clone());
            }
        }

        let maybe_result = {
            let mut receiver_guard = self.receiver.lock().unwrap();
            if let Some(receiver) = receiver_guard.as_mut() {
                match receiver.try_recv() {
                    Ok(result) => {
                        *receiver_guard = None;
                        Some(result)
                    }
                    Err(TryRecvError::Empty) => return PendingState::Pending,
                    Err(TryRecvError::Disconnected) => {
                        *receiver_guard = None;
                        Some(Err("pending operation channel disconnected".to_string()))
                    }
                }
            } else {
                None
            }
        };

        if let Some(result) = maybe_result {
            let mut result_guard = self.result.lock().unwrap();
            *result_guard = Some(result);
        }

        match self.result.lock().unwrap().as_ref() {
            Some(Ok(_)) => PendingState::ReadyOk,
            Some(Err(err)) => PendingState::ReadyErr(err.clone()),
            None => PendingState::Pending,
        }
    }

    pub fn take_result(&self) -> Option<Result<T, String>> {
        self.result.lock().unwrap().take()
    }
}

pub type PendingByteArray = PendingResult<Vec<u8>>;

use std::ffi::c_void;
use std::sync::mpsc::channel;
use std::sync::Arc;
use std::thread;

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use prost::Message;
use serde::Deserialize;
use temporal_client::{
    tonic::IntoRequest, ClientOptionsBuilder, ClientTlsConfig, ConfiguredClient, Namespace,
    RetryClient, TemporalServiceClient, TlsConfig, WorkflowService,
};
use temporal_sdk_core::{CoreRuntime, TokioRuntimeBuilder};
use temporal_sdk_core_api::telemetry::TelemetryOptions;
use thiserror::Error;
use url::Url;

mod byte_array;
mod error;
mod pending;

type PendingClientHandle = pending::PendingResult<ClientHandle>;

#[repr(C)]
pub struct RuntimeHandle {
    runtime: Arc<CoreRuntime>,
}

#[repr(C)]
pub struct ClientHandle {
    runtime: Arc<CoreRuntime>,
    client: RetryClient<ConfiguredClient<TemporalServiceClient>>,
    namespace: String,
}

#[derive(Debug, Deserialize)]
struct ClientConfig {
    address: String,
    namespace: String,
    #[serde(default)]
    identity: Option<String>,
    #[serde(default)]
    client_name: Option<String>,
    #[serde(default)]
    client_version: Option<String>,
    #[serde(default)]
    api_key: Option<String>,
    #[serde(default)]
    tls: Option<ClientTlsConfigPayload>,
}

#[derive(Debug, Deserialize)]
struct ClientTlsConfigPayload {
    #[serde(default)]
    server_root_ca_cert: Option<String>,
    #[serde(default)]
    client_cert: Option<String>,
    #[serde(default)]
    client_private_key: Option<String>,
    #[serde(default)]
    server_name_override: Option<String>,
}

#[derive(Debug, Deserialize)]
struct DescribeNamespaceRequestPayload {
    namespace: String,
}

#[derive(Debug, Error)]
enum BridgeError {
    #[error("invalid runtime handle")]
    InvalidRuntimeHandle,
    #[error("invalid client handle")]
    InvalidClientHandle,
    #[error("missing configuration payload")]
    MissingConfig,
    #[error("failed to parse client configuration: {0}")]
    InvalidConfig(String),
    #[error("failed to parse request payload: {0}")]
    InvalidRequest(String),
    #[error("failed to parse Temporal address: {0}")]
    InvalidAddress(String),
    #[error("Temporal client initialization failed: {0}")]
    ClientInit(String),
    #[error("Temporal request failed: {0}")]
    ClientRequest(String),
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_runtime_new(
    _options_ptr: *const u8,
    _options_len: usize,
) -> *mut c_void {
    match CoreRuntime::new(TelemetryOptions::default(), TokioRuntimeBuilder::default()) {
        Ok(runtime) => {
            let handle = RuntimeHandle {
                runtime: Arc::new(runtime),
            };
            Box::into_raw(Box::new(handle)) as *mut c_void
        }
        Err(err) => {
            error::set_error(format!("failed to initialize Temporal runtime: {err}"));
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_runtime_free(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }

    unsafe {
        let _ = Box::from_raw(handle as *mut RuntimeHandle);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_error_message(len_out: *mut usize) -> *const u8 {
    error::take_error(len_out)
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_error_free(ptr: *mut u8, len: usize) {
    unsafe { error::free_error(ptr, len) }
}

fn runtime_from_ptr(ptr: *mut c_void) -> Result<Arc<CoreRuntime>, BridgeError> {
    if ptr.is_null() {
        return Err(BridgeError::InvalidRuntimeHandle);
    }

    let runtime = unsafe { &*(ptr as *mut RuntimeHandle) };
    Ok(runtime.runtime.clone())
}

fn config_from_raw(ptr: *const u8, len: usize) -> Result<ClientConfig, BridgeError> {
    if ptr.is_null() || len == 0 {
        return Err(BridgeError::MissingConfig);
    }

    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    serde_json::from_slice(bytes).map_err(|err| BridgeError::InvalidConfig(err.to_string()))
}

fn request_from_raw<T>(ptr: *const u8, len: usize) -> Result<T, BridgeError>
where
    T: for<'de> Deserialize<'de>,
{
    if ptr.is_null() || len == 0 {
        return Err(BridgeError::InvalidRequest("empty payload".to_owned()));
    }

    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    serde_json::from_slice(bytes).map_err(|err| BridgeError::InvalidRequest(err.to_string()))
}

fn into_string_error(err: BridgeError) -> *mut c_void {
    error::set_error(err.to_string());
    std::ptr::null_mut()
}

fn client_from_ptr(ptr: *mut c_void) -> Result<&'static ClientHandle, BridgeError> {
    if ptr.is_null() {
        return Err(BridgeError::InvalidClientHandle);
    }
    Ok(unsafe { &*(ptr as *mut ClientHandle) })
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_client_connect_async(
    runtime_ptr: *mut c_void,
    config_ptr: *const u8,
    config_len: usize,
) -> *mut PendingClientHandle {
    let runtime = match runtime_from_ptr(runtime_ptr) {
        Ok(runtime) => runtime,
        Err(err) => return into_string_error(err) as *mut PendingClientHandle,
    };

    let config = match config_from_raw(config_ptr, config_len) {
        Ok(config) => config,
        Err(err) => return into_string_error(err) as *mut PendingClientHandle,
    };

    let url = match Url::parse(&config.address) {
        Ok(url) => url,
        Err(err) => {
            return into_string_error(BridgeError::InvalidAddress(err.to_string()))
                as *mut PendingClientHandle
        }
    };

    let identity = config
        .identity
        .unwrap_or_else(|| format!("temporal-bun-sdk-{}", std::process::id()));
    let client_name = config
        .client_name
        .unwrap_or_else(|| "temporal-bun-sdk".to_string());
    let client_version = config
        .client_version
        .unwrap_or_else(|| env!("CARGO_PKG_VERSION").to_string());

    let mut builder = ClientOptionsBuilder::default();
    builder
        .target_url(url)
        .client_name(client_name)
        .client_version(client_version)
        .identity(identity);

    if let Some(api_key) = config.api_key {
        builder.api_key(Some(api_key));
    }

    if let Some(tls_payload) = config.tls {
        let mut tls = TlsConfig {
            server_root_ca_cert: None,
            domain: tls_payload.server_name_override,
            client_tls_config: None,
        };

        if let Some(ca_b64) = tls_payload.server_root_ca_cert {
            match decode_base64_field(&ca_b64, "server_root_ca_cert") {
                Ok(ca_bytes) => tls.server_root_ca_cert = Some(ca_bytes),
                Err(err) => {
                    return into_string_error(err) as *mut PendingClientHandle;
                }
            }
        }

        match (tls_payload.client_cert, tls_payload.client_private_key) {
            (None, None) => {}
            (Some(cert_b64), Some(key_b64)) => {
                let cert_bytes = match decode_base64_field(&cert_b64, "client_cert") {
                    Ok(bytes) => bytes,
                    Err(err) => {
                        return into_string_error(err) as *mut PendingClientHandle;
                    }
                };
                let key_bytes = match decode_base64_field(&key_b64, "client_private_key") {
                    Ok(bytes) => bytes,
                    Err(err) => {
                        return into_string_error(err) as *mut PendingClientHandle;
                    }
                };
                tls.client_tls_config = Some(ClientTlsConfig {
                    client_cert: cert_bytes,
                    client_private_key: key_bytes,
                });
            }
            _ => {
                return into_string_error(BridgeError::InvalidConfig(
                    "client TLS configuration requires both client_cert and client_private_key".to_owned(),
                )) as *mut PendingClientHandle;
            }
        }

        builder.tls_cfg(tls);
    }

    let options = match builder.build() {
        Ok(options) => options,
        Err(err) => {
            return into_string_error(BridgeError::ClientInit(err.to_string()))
                as *mut PendingClientHandle
        }
    };

    let namespace = config.namespace;
    let runtime_clone = runtime.clone();
    let (tx, rx) = channel();

    thread::spawn(move || {
        let result = runtime_clone.tokio_handle().block_on(async move {
            match options.connect_no_namespace(None).await {
                Ok(client) => Ok(ClientHandle {
                    runtime: runtime_clone.clone(),
                    client,
                    namespace,
                }),
                Err(err) => Err(BridgeError::ClientInit(err.to_string()).to_string()),
            }
        });

        let _ = tx.send(result);
    });

    Box::into_raw(Box::new(PendingClientHandle::new(rx)))
}

fn decode_base64_field(value: &str, field: &str) -> Result<Vec<u8>, BridgeError> {
    BASE64_STANDARD
        .decode(value)
        .map_err(|err| BridgeError::InvalidConfig(format!("invalid base64 for {field}: {err}")))
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_client_free(handle: *mut c_void) {
    if handle.is_null() {
        return;
    }

    unsafe {
        let _ = Box::from_raw(handle as *mut ClientHandle);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_pending_client_poll(ptr: *mut PendingClientHandle) -> i32 {
    if ptr.is_null() {
        error::set_error("invalid pending handle".to_string());
        return -1;
    }

    let pending = unsafe { &*ptr };

    match pending.poll() {
        pending::PendingState::Pending => 0,
        pending::PendingState::ReadyOk => 1,
        pending::PendingState::ReadyErr(err) => {
            error::set_error(err);
            -1
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_pending_client_consume(
    ptr: *mut PendingClientHandle,
) -> *mut c_void {
    if ptr.is_null() {
        error::set_error("invalid pending handle".to_string());
        return std::ptr::null_mut();
    }

    let pending = unsafe { &*ptr };

    match pending.take_result() {
        Some(Ok(handle)) => Box::into_raw(Box::new(handle)) as *mut c_void,
        Some(Err(err)) => {
            error::set_error(err);
            std::ptr::null_mut()
        }
        None => {
            error::set_error("pending result not ready".to_string());
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_pending_client_free(ptr: *mut PendingClientHandle) {
    if ptr.is_null() {
        return;
    }

    unsafe {
        let _ = Box::from_raw(ptr);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_client_describe_namespace_async(
    client_ptr: *mut c_void,
    payload_ptr: *const u8,
    payload_len: usize,
) -> *mut pending::PendingByteArray {
    let client_handle = match client_from_ptr(client_ptr) {
        Ok(client) => client,
        Err(err) => return into_string_error(err) as *mut pending::PendingByteArray,
    };

    let payload =
        match request_from_raw::<DescribeNamespaceRequestPayload>(payload_ptr, payload_len) {
            Ok(payload) => payload,
            Err(err) => {
                return into_string_error(BridgeError::InvalidRequest(err.to_string()))
                    as *mut pending::PendingByteArray
            }
        };

    let runtime = client_handle.runtime.clone();
    let client = client_handle.client.clone();
    let namespace = payload.namespace;

    let (tx, rx) = channel();

    thread::spawn(move || {
        let result = runtime.tokio_handle().block_on(async move {
            let mut inner = client.clone();
            let request = Namespace::Name(namespace).into_describe_namespace_request();
            WorkflowService::describe_namespace(&mut inner, request.into_request())
                .await
                .map(|resp| resp.into_inner().encode_to_vec())
                .map_err(|err| BridgeError::ClientRequest(err.to_string()).to_string())
        });

        let _ = tx.send(result);
    });

    Box::into_raw(Box::new(pending::PendingByteArray::new(rx)))
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_byte_array_free(ptr: *mut byte_array::ByteArray) {
    if ptr.is_null() {
        return;
    }

    unsafe {
        let ba = Box::from_raw(ptr);
        if !ba.ptr.is_null() && ba.cap > 0 {
            let _ = Vec::from_raw_parts(ba.ptr, ba.len, ba.cap);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_pending_byte_array_poll(ptr: *mut pending::PendingByteArray) -> i32 {
    if ptr.is_null() {
        error::set_error("invalid pending handle".to_string());
        return -1;
    }

    let pending = unsafe { &*ptr };

    match pending.poll() {
        pending::PendingState::Pending => 0,
        pending::PendingState::ReadyOk => 1,
        pending::PendingState::ReadyErr(err) => {
            error::set_error(err);
            -1
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_pending_byte_array_consume(
    ptr: *mut pending::PendingByteArray,
) -> *mut byte_array::ByteArray {
    if ptr.is_null() {
        error::set_error("invalid pending handle".to_string());
        return std::ptr::null_mut();
    }

    let pending = unsafe { &*ptr };

    match pending.take_result() {
        Some(Ok(bytes)) => byte_array::ByteArray::from_vec(bytes),
        Some(Err(err)) => {
            error::set_error(err);
            std::ptr::null_mut()
        }
        None => {
            error::set_error("pending result not ready".to_string());
            std::ptr::null_mut()
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_pending_byte_array_free(ptr: *mut pending::PendingByteArray) {
    if ptr.is_null() {
        return;
    }

    unsafe {
        let _ = Box::from_raw(ptr);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_from_raw_parses_defaults() {
        let json = br#"{"address":"http://localhost:7233","namespace":"default"}"#;
        let cfg = config_from_raw(json.as_ptr(), json.len()).expect("config parsed");
        assert_eq!(cfg.address, "http://localhost:7233");
        assert_eq!(cfg.namespace, "default");
    }

    #[test]
    fn config_from_raw_errors_on_missing_payload() {
        let err = config_from_raw(std::ptr::null(), 0).unwrap_err();
        assert!(matches!(err, BridgeError::MissingConfig));
    }

    #[test]
    fn request_from_raw_validates_payload() {
        let json = br#"{"namespace":"test"}"#;
        let payload: DescribeNamespaceRequestPayload =
            request_from_raw(json.as_ptr(), json.len()).expect("parsed request");
        assert_eq!(payload.namespace, "test");

        let invalid =
            request_from_raw::<DescribeNamespaceRequestPayload>(br"{}".as_ptr(), 2).unwrap_err();
        assert!(matches!(invalid, BridgeError::InvalidRequest(_)));
    }
}

use std::ffi::c_void;
use std::sync::Arc;

use prost::Message;
use serde::Deserialize;
use temporal_client::{
    ClientOptionsBuilder, ConfiguredClient, Namespace, RetryClient, TemporalServiceClient,
    WorkflowService,
    tonic::IntoRequest,
};
use temporal_sdk_core::{CoreRuntime, TokioRuntimeBuilder};
use temporal_sdk_core_api::telemetry::TelemetryOptions;
use thiserror::Error;
use url::Url;

mod error;
mod byte_array;

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
pub extern "C" fn temporal_bun_runtime_new(_options_ptr: *const u8, _options_len: usize) -> *mut c_void {
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
pub extern "C" fn temporal_bun_client_connect(
    runtime_ptr: *mut c_void,
    config_ptr: *const u8,
    config_len: usize,
) -> *mut c_void {
    let runtime = match runtime_from_ptr(runtime_ptr) {
        Ok(runtime) => runtime,
        Err(err) => return into_string_error(err),
    };

    let config = match config_from_raw(config_ptr, config_len) {
        Ok(config) => config,
        Err(err) => return into_string_error(err),
    };

    let url = match Url::parse(&config.address) {
        Ok(url) => url,
        Err(err) => return into_string_error(BridgeError::InvalidAddress(err.to_string())),
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

    let options = match builder.build() {
        Ok(options) => options,
        Err(err) => return into_string_error(BridgeError::ClientInit(err.to_string())),
    };

    let connect_result = runtime
        .tokio_handle()
        .block_on(async { options.connect_no_namespace(None).await });

    let client = match connect_result {
        Ok(client) => client,
        Err(err) => return into_string_error(BridgeError::ClientInit(err.to_string())),
    };

    let handle = ClientHandle {
        runtime,
        client,
        namespace: config.namespace,
    };

    Box::into_raw(Box::new(handle)) as *mut c_void
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
pub extern "C" fn temporal_bun_client_describe_namespace(
    client_ptr: *mut c_void,
    payload_ptr: *const u8,
    payload_len: usize,
) -> *mut byte_array::ByteArray {
    let client_handle = match client_from_ptr(client_ptr) {
        Ok(client) => client,
        Err(err) => return into_string_error(err) as *mut byte_array::ByteArray,
    };

    let payload = match request_from_raw::<DescribeNamespaceRequestPayload>(payload_ptr, payload_len) {
        Ok(payload) => payload,
        Err(err) => {
            return into_string_error(BridgeError::InvalidRequest(err.to_string()))
                as *mut byte_array::ByteArray
        }
    };

    let runtime = client_handle.runtime.clone();
    let client = client_handle.client.clone();
    let namespace = payload.namespace;

    let response = runtime.tokio_handle().block_on(async move {
        let mut inner = client.clone();
        let request = Namespace::Name(namespace).into_describe_namespace_request();
        WorkflowService::describe_namespace(&mut inner, request.into_request()).await
    });

    let response = match response {
        Ok(resp) => resp.into_inner(),
        Err(err) => {
            return into_string_error(BridgeError::ClientRequest(err.to_string()))
                as *mut byte_array::ByteArray
        }
    };

    let bytes = response.encode_to_vec();
    byte_array::ByteArray::from_vec(bytes)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_from_raw_parses_defaults() {
        let json = br#"{"address":"http://localhost:7233","namespace":"default"}"#;
        let cfg = config_from_raw(json.as_ptr(), json.len()).expect("config parsed")
;
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

        let invalid = request_from_raw::<DescribeNamespaceRequestPayload>(
            br"{}".as_ptr(),
            2,
        )
        .unwrap_err();
        assert!(matches!(invalid, BridgeError::InvalidRequest(_)));
    }
}

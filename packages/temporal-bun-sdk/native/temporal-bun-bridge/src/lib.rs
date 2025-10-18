use std::collections::HashMap;
use std::ffi::c_void;
use std::fmt;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::str;
use std::sync::{mpsc::channel, Arc, RwLock};
use std::thread;

use base64::{engine::general_purpose, Engine as _};
use prost::Message;
use prost_wkt_types::Duration as ProtoDuration;
use serde::Deserialize;
use temporal_client::{
    tonic::IntoRequest, ClientOptionsBuilder, ClientTlsConfig, ConfiguredClient, Namespace,
    RetryClient, TemporalServiceClient, TlsConfig, WorkflowService,
};
use temporal_sdk_core::{CoreRuntime, TokioRuntimeBuilder, telemetry::construct_filter_string};
use temporal_sdk_core_api::telemetry::{CoreLog, CoreLogConsumer, Logger, TelemetryOptionsBuilder};
use tracing::Level as TracingLevel;
use tracing_core::Level as TracingCoreLevel;
use temporal_sdk_core_protos::temporal::api::common::v1::{
    Header, Memo, Payload, Payloads, RetryPolicy, SearchAttributes, WorkflowType,
};
use temporal_sdk_core_protos::temporal::api::enums::v1::TaskQueueKind;
use temporal_sdk_core_protos::temporal::api::taskqueue::v1::TaskQueue;
use temporal_sdk_core_protos::temporal::api::workflowservice::v1::StartWorkflowExecutionRequest;
use thiserror::Error;
use url::Url;
use uuid::Uuid;

mod byte_array;
mod error;
mod pending;

type PendingClientHandle = pending::PendingResult<ClientHandle>;

#[repr(C)]
struct BunLogSlice {
    data: *const u8,
    len: usize,
}

impl BunLogSlice {
    fn from_bytes(bytes: &[u8]) -> Self {
        Self {
            data: bytes.as_ptr(),
            len: bytes.len(),
        }
    }
}

#[repr(C)]
struct BunLogRecord {
    level: i32,
    timestamp_ms: u64,
    target: BunLogSlice,
    message: BunLogSlice,
    fields_json: BunLogSlice,
    spans_json: BunLogSlice,
}

type LoggerCallback = unsafe extern "C" fn(*const BunLogRecord);

#[derive(Default)]
struct LoggerState {
    callback: RwLock<Option<LoggerCallback>>,
}

impl LoggerState {
    fn set_callback(&self, callback: Option<LoggerCallback>) {
        let mut guard = self.callback.write().expect("logger callback write lock");
        *guard = callback;
    }

    fn get_callback(&self) -> Option<LoggerCallback> {
        let guard = self.callback.read().expect("logger callback read lock");
        *guard
    }

    fn clear(&self) {
        self.set_callback(None);
    }
}

#[repr(i32)]
enum BunLogLevel {
    Trace = 0,
    Debug = 1,
    Info = 2,
    Warn = 3,
    Error = 4,
}

impl From<TracingCoreLevel> for BunLogLevel {
    fn from(level: TracingCoreLevel) -> Self {
        match level {
            TracingCoreLevel::TRACE => BunLogLevel::Trace,
            TracingCoreLevel::DEBUG => BunLogLevel::Debug,
            TracingCoreLevel::INFO => BunLogLevel::Info,
            TracingCoreLevel::WARN => BunLogLevel::Warn,
            TracingCoreLevel::ERROR => BunLogLevel::Error,
        }
    }
}

struct BunLogConsumer {
    state: Arc<LoggerState>,
}

impl BunLogConsumer {
    fn new(state: Arc<LoggerState>) -> Self {
        Self { state }
    }

    fn dispatch(&self, log: CoreLog) {
        let callback = match self.state.get_callback() {
            Some(callback) => callback,
            None => return,
        };

        let CoreLog {
            target,
            message,
            timestamp,
            level,
            fields,
            span_contexts,
        } = log;

        let target = target.into_bytes();
        let message = message.into_bytes();
        let fields_json = serde_json::to_vec(&fields).unwrap_or_else(|_| b"{}".to_vec());
        let spans_json =
            serde_json::to_vec(&span_contexts).unwrap_or_else(|_| b"[]".to_vec());

        let record = BunLogRecord {
            level: BunLogLevel::from(level) as i32,
            timestamp_ms: timestamp
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis()
                .try_into()
                .unwrap_or(u64::MAX),
            target: BunLogSlice::from_bytes(&target),
            message: BunLogSlice::from_bytes(&message),
            fields_json: BunLogSlice::from_bytes(&fields_json),
            spans_json: BunLogSlice::from_bytes(&spans_json),
        };

        let result = catch_unwind(AssertUnwindSafe(|| unsafe {
            callback(&record);
        }));

        if result.is_err() {
            eprintln!(
                "temporal-bun-bridge: logger callback panicked; disabling logger forwarding"
            );
            self.state.clear();
        }
    }
}

impl CoreLogConsumer for BunLogConsumer {
    fn on_log(&self, log: CoreLog) {
        self.dispatch(log);
    }
}

impl fmt::Debug for BunLogConsumer {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("<bun log consumer>")
    }
}

#[repr(C)]
pub struct RuntimeHandle {
    runtime: Arc<CoreRuntime>,
    logger_state: Arc<LoggerState>,
}

#[repr(C)]
pub struct ClientHandle {
    runtime: Arc<CoreRuntime>,
    client: RetryClient<ConfiguredClient<TemporalServiceClient>>,
    namespace: String,
    identity: String,
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

#[derive(Clone, Debug, Deserialize)]
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

#[derive(Debug, Deserialize)]
struct StartWorkflowRequestPayload {
    #[serde(default)]
    namespace: Option<String>,
    workflow_id: String,
    workflow_type: String,
    task_queue: String,
    #[serde(default)]
    args: Option<Vec<serde_json::Value>>,
    #[serde(default)]
    memo: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    search_attributes: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    headers: Option<HashMap<String, serde_json::Value>>,
    #[serde(default)]
    cron_schedule: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    identity: Option<String>,
    #[serde(default)]
    workflow_execution_timeout_ms: Option<u64>,
    #[serde(default)]
    workflow_run_timeout_ms: Option<u64>,
    #[serde(default)]
    workflow_task_timeout_ms: Option<u64>,
    #[serde(default)]
    retry_policy: Option<RetryPolicyPayload>,
}

#[derive(Debug, Deserialize, Default)]
struct RetryPolicyPayload {
    #[serde(default)]
    initial_interval_ms: Option<u64>,
    #[serde(default)]
    maximum_interval_ms: Option<u64>,
    #[serde(default)]
    maximum_attempts: Option<i32>,
    #[serde(default)]
    backoff_coefficient: Option<f64>,
    #[serde(default)]
    non_retryable_error_types: Option<Vec<String>>,
}

struct StartWorkflowDefaults<'a> {
    namespace: &'a str,
    identity: &'a str,
}

struct StartWorkflowResponseInfo {
    workflow_id: String,
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
    #[error("failed to encode payload: {0}")]
    PayloadEncode(String),
    #[error("failed to encode response payload: {0}")]
    ResponseEncode(String),
    #[error("invalid TLS configuration: {0}")]
    InvalidTlsConfig(String),
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_runtime_new(
    _options_ptr: *const u8,
    _options_len: usize,
) -> *mut c_void {
    let logger_state = Arc::new(LoggerState::default());
    let consumer: Arc<dyn CoreLogConsumer> = Arc::new(BunLogConsumer::new(logger_state.clone()));

    let telemetry_options = match TelemetryOptionsBuilder::default()
        .logging(Logger::Push {
            filter: construct_filter_string(TracingLevel::INFO, TracingLevel::WARN),
            consumer,
        })
        .build()
    {
        Ok(options) => options,
        Err(err) => {
            error::set_error(format!("failed to configure Temporal telemetry: {err}"));
            return std::ptr::null_mut();
        }
    };

    match CoreRuntime::new(telemetry_options, TokioRuntimeBuilder::default()) {
        Ok(runtime) => {
            let handle = RuntimeHandle {
                runtime: Arc::new(runtime),
                logger_state,
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
        let handle = Box::from_raw(handle as *mut RuntimeHandle);
        handle.logger_state.clear();
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_runtime_update_telemetry(
    _runtime_ptr: *mut c_void,
    _options_ptr: *const u8,
    _options_len: usize,
) -> i32 {
    // TODO(codex): Configure telemetry exporters (Prometheus, OTLP) via CoreRuntime once the plan in
    // docs/ffi-surface.md is implemented.
    error::set_error("temporal_bun_runtime_update_telemetry is not implemented yet".to_string());
    -1
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_runtime_set_logger(
    _runtime_ptr: *mut c_void,
    _callback_ptr: *mut c_void,
) -> i32 {
    let handle = match runtime_handle_from_ptr(_runtime_ptr) {
        Ok(handle) => handle,
        Err(err) => {
            error::set_error(err.to_string());
            return -1;
        }
    };

    if _callback_ptr.is_null() {
        handle.logger_state.clear();
        return 0;
    }

    let callback: LoggerCallback = unsafe { std::mem::transmute(_callback_ptr) };
    handle.logger_state.set_callback(Some(callback));
    0
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_runtime_emit_test_log(
    runtime_ptr: *mut c_void,
    level: i32,
    message_ptr: *const u8,
    message_len: usize,
) -> i32 {
    let _ = match runtime_handle_from_ptr(runtime_ptr) {
        Ok(handle) => handle,
        Err(err) => {
            error::set_error(err.to_string());
            return -1;
        }
    };

    let message = if message_ptr.is_null() || message_len == 0 {
        "temporal-bun test log".to_string()
    } else {
        let bytes = unsafe { std::slice::from_raw_parts(message_ptr, message_len) };
        match str::from_utf8(bytes) {
            Ok(value) => value.to_string(),
            Err(_) => {
                error::set_error("log message must be valid UTF-8".to_string());
                return -1;
            }
        }
    };

    let level = match level {
        0 => TracingLevel::TRACE,
        1 => TracingLevel::DEBUG,
        2 => TracingLevel::INFO,
        3 => TracingLevel::WARN,
        4 => TracingLevel::ERROR,
        _ => {
            error::set_error("invalid log level".to_string());
            return -1;
        }
    };

    match level {
        TracingLevel::TRACE => tracing::event!(target: "temporal_sdk_core::bridge::test", tracing::Level::TRACE, payload = %message, "{}", message),
        TracingLevel::DEBUG => tracing::event!(target: "temporal_sdk_core::bridge::test", tracing::Level::DEBUG, payload = %message, "{}", message),
        TracingLevel::INFO => tracing::event!(target: "temporal_sdk_core::bridge::test", tracing::Level::INFO, payload = %message, "{}", message),
        TracingLevel::WARN => tracing::event!(target: "temporal_sdk_core::bridge::test", tracing::Level::WARN, payload = %message, "{}", message),
        TracingLevel::ERROR => tracing::event!(target: "temporal_sdk_core::bridge::test", tracing::Level::ERROR, payload = %message, "{}", message),
    };

    0
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
    let handle = runtime_handle_from_ptr(ptr)?;
    Ok(handle.runtime.clone())
}

fn runtime_handle_from_ptr(ptr: *mut c_void) -> Result<&'static RuntimeHandle, BridgeError> {
    if ptr.is_null() {
        return Err(BridgeError::InvalidRuntimeHandle);
    }

    let runtime = unsafe { &*(ptr as *mut RuntimeHandle) };
    Ok(runtime)
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
        .identity(identity.clone());

    if let Some(api_key) = config.api_key.clone() {
        builder.api_key(Some(api_key));
    }

    if let Some(tls_payload) = config.tls.clone() {
        match tls_config_from_payload(tls_payload) {
            Ok(tls_cfg) => {
                builder.tls_cfg(tls_cfg);
            }
            Err(err) => return into_string_error(err) as *mut PendingClientHandle,
        }
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
    let identity_clone = identity.clone();
    let (tx, rx) = channel();

    thread::spawn(move || {
        let result = runtime_clone.tokio_handle().block_on(async move {
            match options.connect_no_namespace(None).await {
                Ok(client) => Ok(ClientHandle {
                    runtime: runtime_clone.clone(),
                    client,
                    namespace,
                    identity: identity_clone.clone(),
                }),
                Err(err) => Err(BridgeError::ClientInit(err.to_string()).to_string()),
            }
        });

        let _ = tx.send(result);
    });

    Box::into_raw(Box::new(PendingClientHandle::new(rx)))
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
pub extern "C" fn temporal_bun_client_update_headers(
    _client_ptr: *mut c_void,
    _headers_ptr: *const u8,
    _headers_len: usize,
) -> i32 {
    // TODO(codex): Allow metadata mutation on the gRPC client (api keys, routing headers) as described in docs/ffi-surface.md.
    error::set_error("temporal_bun_client_update_headers is not implemented yet".to_string());
    -1
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
pub extern "C" fn temporal_bun_client_start_workflow(
    client_ptr: *mut c_void,
    payload_ptr: *const u8,
    payload_len: usize,
) -> *mut byte_array::ByteArray {
    let client_handle = match client_from_ptr(client_ptr) {
        Ok(client) => client,
        Err(err) => return into_string_error(err) as *mut byte_array::ByteArray,
    };

    let payload = match request_from_raw::<StartWorkflowRequestPayload>(payload_ptr, payload_len) {
        Ok(payload) => payload,
        Err(err) => {
            return into_string_error(BridgeError::InvalidRequest(err.to_string()))
                as *mut byte_array::ByteArray
        }
    };

    let defaults = StartWorkflowDefaults {
        namespace: &client_handle.namespace,
        identity: &client_handle.identity,
    };

    let (request, response_info) = match build_start_workflow_request(payload, defaults) {
        Ok(result) => result,
        Err(err) => return into_string_error(err) as *mut byte_array::ByteArray,
    };

    let runtime = client_handle.runtime.clone();
    let client = client_handle.client.clone();

    let response = runtime.tokio_handle().block_on(async move {
        let mut inner = client.clone();
        WorkflowService::start_workflow_execution(&mut inner, request.into_request()).await
    });

    let response = match response {
        Ok(resp) => resp.into_inner(),
        Err(err) => {
            return into_string_error(BridgeError::ClientRequest(err.to_string()))
                as *mut byte_array::ByteArray
        }
    };

    let response_body = serde_json::json!({
        "runId": response.run_id,
        "workflowId": response_info.workflow_id,
        "namespace": response_info.namespace,
    });

    let bytes = match json_bytes(&response_body) {
        Ok(bytes) => bytes,
        Err(err) => return into_string_error(err) as *mut byte_array::ByteArray,
    };

    byte_array::ByteArray::from_vec(bytes)
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_byte_array_new(ptr: *const u8, len: usize) -> *mut byte_array::ByteArray {
    // TODO(codex): Optimize zero-copy transfers once native bridge exposes shared buffers (docs/ffi-surface.md).
    if ptr.is_null() || len == 0 {
        return byte_array::ByteArray::empty();
    }
    let slice = unsafe { std::slice::from_raw_parts(ptr, len) };
    byte_array::ByteArray::from_vec(slice.to_vec())
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

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_client_signal(
    _client_ptr: *mut c_void,
    _payload_ptr: *const u8,
    _payload_len: usize,
) -> *mut pending::PendingByteArray {
    // TODO(codex): Implement workflow signal bridge invoking WorkflowService::signal_workflow_execution (docs/ffi-surface.md).
    error::set_error("temporal_bun_client_signal is not implemented yet".to_string());
    std::ptr::null_mut()
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_client_query(
    _client_ptr: *mut c_void,
    _payload_ptr: *const u8,
    _payload_len: usize,
) -> *mut pending::PendingByteArray {
    // TODO(codex): Implement workflow query bridge using QueryWorkflowRequest per docs/ffi-surface.md.
    error::set_error("temporal_bun_client_query is not implemented yet".to_string());
    std::ptr::null_mut()
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_client_terminate_workflow(
    _client_ptr: *mut c_void,
    _payload_ptr: *const u8,
    _payload_len: usize,
) -> *mut pending::PendingByteArray {
    // TODO(codex): Implement termination via WorkflowService::terminate_workflow_execution (docs/ffi-surface.md).
    error::set_error("temporal_bun_client_terminate_workflow is not implemented yet".to_string());
    std::ptr::null_mut()
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_client_cancel_workflow(
    _client_ptr: *mut c_void,
    _payload_ptr: *const u8,
    _payload_len: usize,
) -> *mut pending::PendingByteArray {
    // TODO(codex): Implement cancellation via WorkflowService::request_cancel_workflow_execution (docs/ffi-surface.md).
    error::set_error("temporal_bun_client_cancel_workflow is not implemented yet".to_string());
    std::ptr::null_mut()
}

#[unsafe(no_mangle)]
pub extern "C" fn temporal_bun_client_signal_with_start(
    _client_ptr: *mut c_void,
    _payload_ptr: *const u8,
    _payload_len: usize,
) -> *mut pending::PendingByteArray {
    // TODO(codex): Implement signal-with-start using WorkflowService::signal_with_start_workflow_execution (docs/ffi-surface.md).
    error::set_error("temporal_bun_client_signal_with_start is not implemented yet".to_string());
    std::ptr::null_mut()
}


fn encode_payload(value: serde_json::Value) -> Result<Payload, BridgeError> {
    let data = serde_json::to_vec(&value).map_err(|err| BridgeError::PayloadEncode(err.to_string()))?;
    let mut metadata = HashMap::new();
    metadata.insert("encoding".to_string(), b"json/plain".to_vec());
    Ok(Payload { metadata, data })
}

fn build_start_workflow_request(
    payload: StartWorkflowRequestPayload,
    defaults: StartWorkflowDefaults,
) -> Result<(StartWorkflowExecutionRequest, StartWorkflowResponseInfo), BridgeError> {
    let StartWorkflowRequestPayload {
        namespace,
        workflow_id,
        workflow_type,
        task_queue,
        args,
        memo,
        search_attributes,
        headers,
        cron_schedule,
        request_id,
        identity,
        workflow_execution_timeout_ms,
        workflow_run_timeout_ms,
        workflow_task_timeout_ms,
        retry_policy,
    } = payload;

    let namespace = namespace.unwrap_or_else(|| defaults.namespace.to_string());
    let identity = identity.unwrap_or_else(|| defaults.identity.to_string());
    let request_id = request_id.unwrap_or_else(|| Uuid::new_v4().to_string());

    let mut request = StartWorkflowExecutionRequest {
        namespace: namespace.clone(),
        workflow_id: workflow_id.clone(),
        workflow_type: Some(WorkflowType { name: workflow_type }),
        task_queue: Some(TaskQueue {
            name: task_queue,
            kind: TaskQueueKind::Normal as i32,
            normal_name: String::new(),
        }),
        identity,
        request_id,
        ..Default::default()
    };

    if let Some(values) = args {
        let mut encoded = Vec::with_capacity(values.len());
        for value in values {
            encoded.push(encode_payload(value)?);
        }
        request.input = Some(Payloads { payloads: encoded });
    }

    match encode_payload_map(memo)? {
        Some(fields) => request.memo = Some(Memo { fields }),
        None => {}
    }

    match encode_payload_map(search_attributes)? {
        Some(fields) => {
            request.search_attributes = Some(SearchAttributes { indexed_fields: fields });
        }
        None => {}
    }

    match encode_payload_map(headers)? {
        Some(fields) => request.header = Some(Header { fields }),
        None => {}
    }

    if let Some(schedule) = cron_schedule {
        request.cron_schedule = schedule;
    }

    if let Some(ms) = workflow_execution_timeout_ms {
        request.workflow_execution_timeout = Some(duration_from_millis(ms));
    }

    if let Some(ms) = workflow_run_timeout_ms {
        request.workflow_run_timeout = Some(duration_from_millis(ms));
    }

    if let Some(ms) = workflow_task_timeout_ms {
        request.workflow_task_timeout = Some(duration_from_millis(ms));
    }

    if let Some(policy) = retry_policy {
        request.retry_policy = Some(encode_retry_policy(policy)?);
    }

    let response_info = StartWorkflowResponseInfo {
        workflow_id,
        namespace,
    };

    Ok((request, response_info))
}

fn encode_payload_map(
    map: Option<HashMap<String, serde_json::Value>>,
) -> Result<Option<HashMap<String, Payload>>, BridgeError> {
    match map {
        Some(entries) => {
            if entries.is_empty() {
                return Ok(None);
            }
            let mut encoded = HashMap::with_capacity(entries.len());
            for (key, value) in entries {
                encoded.insert(key, encode_payload(value)?);
            }
            Ok(Some(encoded))
        }
        None => Ok(None),
    }
}

fn encode_retry_policy(payload: RetryPolicyPayload) -> Result<RetryPolicy, BridgeError> {
    let mut policy = RetryPolicy::default();
    if let Some(ms) = payload.initial_interval_ms {
        policy.initial_interval = Some(duration_from_millis(ms));
    }
    if let Some(ms) = payload.maximum_interval_ms {
        policy.maximum_interval = Some(duration_from_millis(ms));
    }
    if let Some(attempts) = payload.maximum_attempts {
        policy.maximum_attempts = attempts;
    }
    if let Some(coefficient) = payload.backoff_coefficient {
        policy.backoff_coefficient = coefficient;
    }
    if let Some(errors) = payload.non_retryable_error_types {
        policy.non_retryable_error_types = errors;
    }
    Ok(policy)
}

fn tls_config_from_payload(payload: ClientTlsConfigPayload) -> Result<TlsConfig, BridgeError> {
    let mut tls = TlsConfig::default();

    if let Some(server_root_ca) = payload.server_root_ca_cert {
        let bytes = decode_base64(&server_root_ca)
            .map_err(|err| BridgeError::InvalidTlsConfig(format!("invalid server_root_ca_cert: {err}")))?;
        tls.server_root_ca_cert = Some(bytes);
    }

    match (payload.client_cert, payload.client_private_key) {
        (Some(cert_b64), Some(key_b64)) => {
            let cert = decode_base64(&cert_b64)
                .map_err(|err| BridgeError::InvalidTlsConfig(format!("invalid client_cert: {err}")))?;
            let key = decode_base64(&key_b64)
                .map_err(|err| BridgeError::InvalidTlsConfig(format!("invalid client_private_key: {err}")))?;
            tls.client_tls_config = Some(ClientTlsConfig {
                client_cert: cert,
                client_private_key: key,
            });
        }
        (None, None) => {}
        _ => {
            return Err(BridgeError::InvalidTlsConfig(
                "client_cert and client_private_key must both be provided".to_string(),
            ));
        }
    }

    if let Some(server_name) = payload.server_name_override {
        if !server_name.is_empty() {
            tls.domain = Some(server_name);
        }
    }

    Ok(tls)
}

fn decode_base64(value: &str) -> Result<Vec<u8>, base64::DecodeError> {
    general_purpose::STANDARD.decode(value)
}

fn json_bytes<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, BridgeError> {
    serde_json::to_vec(value).map_err(|err| BridgeError::ResponseEncode(err.to_string()))
}

fn duration_from_millis(ms: u64) -> ProtoDuration {
    ProtoDuration {
        seconds: (ms / 1_000) as i64,
        nanos: ((ms % 1_000) * 1_000_000) as i32,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use serde_json::json;

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

    #[test]
    fn tls_config_from_payload_decodes_components() {
        let payload = ClientTlsConfigPayload {
            server_root_ca_cert: Some(general_purpose::STANDARD.encode(b"ROOT")),
            client_cert: Some(general_purpose::STANDARD.encode(b"CERT")),
            client_private_key: Some(general_purpose::STANDARD.encode(b"KEY")),
            server_name_override: Some("server.test".to_string()),
        };

        let tls = tls_config_from_payload(payload).expect("parsed tls config");
        assert_eq!(tls.server_root_ca_cert, Some(b"ROOT".to_vec()));
        assert_eq!(tls.domain.as_deref(), Some("server.test"));
        let client = tls.client_tls_config.expect("client tls");
        assert_eq!(client.client_cert, b"CERT");
        assert_eq!(client.client_private_key, b"KEY");
    }

    #[test]
    fn tls_config_from_payload_errors_without_key_pair() {
        let payload = ClientTlsConfigPayload {
            server_root_ca_cert: None,
            client_cert: Some(general_purpose::STANDARD.encode(b"CERT")),
            client_private_key: None,
            server_name_override: None,
        };

        let err = tls_config_from_payload(payload).unwrap_err();
        assert!(matches!(err, BridgeError::InvalidTlsConfig(_)));
    }

    #[test]
    fn build_start_workflow_request_applies_defaults() {
        let payload = StartWorkflowRequestPayload {
            namespace: None,
            workflow_id: "wf-123".to_string(),
            workflow_type: "ExampleWorkflow".to_string(),
            task_queue: "prix".to_string(),
            args: None,
            memo: None,
            search_attributes: None,
            headers: None,
            cron_schedule: None,
            request_id: None,
            identity: None,
            workflow_execution_timeout_ms: None,
            workflow_run_timeout_ms: None,
            workflow_task_timeout_ms: None,
            retry_policy: None,
        };

        let defaults = StartWorkflowDefaults {
            namespace: "default",
            identity: "worker-1",
        };

        let (request, info) = build_start_workflow_request(payload, defaults).expect("build request");
        assert_eq!(request.namespace, "default");
        assert_eq!(request.identity, "worker-1");
        assert_eq!(request.workflow_id, "wf-123");
        assert_eq!(request.task_queue.unwrap().name, "prix");
        assert!(request.workflow_execution_timeout.is_none());
        assert!(request.workflow_run_timeout.is_none());
        assert!(request.workflow_task_timeout.is_none());
        assert!(request.retry_policy.is_none());
        assert_eq!(info.workflow_id, "wf-123");
        assert_eq!(info.namespace, "default");
    }

    #[test]
    fn build_start_workflow_request_encodes_payloads_timeouts_and_policy() {
        let args = vec![json!("hello"), json!({ "count": 2 })];
        let memo = HashMap::from([(String::from("note"), json!("memo"))]);
        let headers = HashMap::from([(String::from("auth"), json!("bearer"))]);
        let search = HashMap::from([(String::from("env"), json!("dev"))]);

        let payload = StartWorkflowRequestPayload {
            namespace: Some("analytics".to_string()),
            workflow_id: "wf-xyz".to_string(),
            workflow_type: "ExampleWorkflow".to_string(),
            task_queue: "prix".to_string(),
            args: Some(args),
            memo: Some(memo),
            search_attributes: Some(search),
            headers: Some(headers),
            cron_schedule: Some("*/5 * * * *".to_string()),
            request_id: Some("req-1".to_string()),
            identity: Some("custom-worker".to_string()),
            workflow_execution_timeout_ms: Some(1_500),
            workflow_run_timeout_ms: Some(2_000),
            workflow_task_timeout_ms: Some(750),
            retry_policy: Some(RetryPolicyPayload {
                initial_interval_ms: Some(2_500),
                maximum_interval_ms: Some(10_000),
                maximum_attempts: Some(3),
                backoff_coefficient: Some(2.0),
                non_retryable_error_types: Some(vec!["Fatal".to_string()]),
            }),
        };

        let defaults = StartWorkflowDefaults {
            namespace: "default",
            identity: "worker-1",
        };

        let (request, info) = build_start_workflow_request(payload, defaults).expect("build request");

        let inputs = request.input.expect("payloads").payloads;
        assert_eq!(inputs.len(), 2);
        assert_eq!(request.identity, "custom-worker");
        assert_eq!(request.namespace, "analytics");
        assert_eq!(info.namespace, "analytics");
        assert_eq!(request.cron_schedule, "*/5 * * * *");

        let execution_timeout = request
            .workflow_execution_timeout
            .expect("execution timeout");
        assert_eq!(execution_timeout.seconds, 1);
        assert_eq!(execution_timeout.nanos, 500_000_000);

        let run_timeout = request.workflow_run_timeout.expect("run timeout");
        assert_eq!(run_timeout.seconds, 2);
        assert_eq!(run_timeout.nanos, 0);

        let task_timeout = request.workflow_task_timeout.expect("task timeout");
        assert_eq!(task_timeout.seconds, 0);
        assert_eq!(task_timeout.nanos, 750_000_000);

        let retry = request.retry_policy.expect("retry policy");
        let initial_interval = retry.initial_interval.expect("initial interval");
        assert_eq!(initial_interval.seconds, 2);
        assert_eq!(initial_interval.nanos, 500_000_000);
        let maximum_interval = retry.maximum_interval.expect("maximum interval");
        assert_eq!(maximum_interval.seconds, 10);
        assert_eq!(maximum_interval.nanos, 0);
        assert_eq!(retry.maximum_attempts, 3);
        assert_eq!(retry.backoff_coefficient, 2.0);
        assert_eq!(retry.non_retryable_error_types, vec!["Fatal".to_string()]);

        let memo_fields = request.memo.unwrap().fields;
        assert!(memo_fields.contains_key("note"));
        let header_fields = request.header.unwrap().fields;
        assert!(header_fields.contains_key("auth"));
        let search_fields = request.search_attributes.unwrap().indexed_fields;
        assert!(search_fields.contains_key("env"));
    }
}

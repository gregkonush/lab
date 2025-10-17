use std::collections::HashMap;
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
use temporal_sdk_core_protos::temporal::api::common::v1::{
    Header, Memo, Payload, Payloads, RetryPolicy, SearchAttributes, WorkflowType,
};
use temporal_sdk_core_protos::temporal::api::enums::v1::TaskQueueKind;
use temporal_sdk_core_protos::temporal::api::taskqueue::v1::TaskQueue;
use temporal_sdk_core_protos::temporal::api::workflowservice::v1::StartWorkflowExecutionRequest;
use thiserror::Error;
use url::Url;
use uuid::Uuid;

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
}

#[derive(Debug, Deserialize)]
struct DescribeNamespaceRequestPayload {
    namespace: String,
}

#[allow(dead_code)]
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

#[allow(dead_code)]
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
        .identity(identity.clone());

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
        identity,
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
        retry_policy,
        ..
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

    if let Some(schedule) = cron_schedule {
        request.cron_schedule = schedule;
    }

    if let Some(policy) = retry_policy {
        request.retry_policy = Some(encode_retry_policy(policy)?);
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

fn json_bytes<T: serde::Serialize>(value: &T) -> Result<Vec<u8>, BridgeError> {
    serde_json::to_vec(value).map_err(|err| BridgeError::ResponseEncode(err.to_string()))
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
    use serde_json::json;

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
        assert_eq!(info.workflow_id, "wf-123");
        assert_eq!(info.namespace, "default");
    }

    #[test]
    fn build_start_workflow_request_encodes_payloads_and_policy() {
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
            workflow_execution_timeout_ms: None,
            workflow_run_timeout_ms: None,
            workflow_task_timeout_ms: None,
            retry_policy: Some(RetryPolicyPayload {
                maximum_attempts: Some(3),
                backoff_coefficient: Some(2.0),
                non_retryable_error_types: Some(vec!["Fatal".to_string()]),
                ..Default::default()
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
        assert!(request.workflow_execution_timeout.is_none());
        assert!(request.workflow_run_timeout.is_none());
        assert!(request.workflow_task_timeout.is_none());
        let retry = request.retry_policy.clone().expect("retry policy set");
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

//! Builders and helpers for translating JSON payloads into Temporal service requests.

use std::collections::HashMap;
use std::mem::take;

use prost_wkt_types::Duration as ProtoDuration;
use serde::Serialize;
use serde_json::Value;
use temporal_sdk_core_protos::temporal::api::common::v1::{
    Header, Memo, Payload, Payloads, RetryPolicy, SearchAttributes, WorkflowExecution, WorkflowType,
};
use temporal_sdk_core_protos::temporal::api::enums::v1::{QueryRejectCondition, TaskQueueKind};
use temporal_sdk_core_protos::temporal::api::query::v1::WorkflowQuery;
use temporal_sdk_core_protos::temporal::api::taskqueue::v1::TaskQueue;
use temporal_sdk_core_protos::temporal::api::workflowservice::v1::{
    QueryWorkflowRequest, SignalWithStartWorkflowExecutionRequest, StartWorkflowExecutionRequest,
    TerminateWorkflowExecutionRequest,
};
use uuid::Uuid;

use super::{
    BridgeError, QueryWorkflowRequestPayload, RetryPolicyPayload, SignalWithStartRequestPayload,
    StartWorkflowRequestPayload, TerminateWorkflowRequestPayload,
};

pub(crate) struct StartWorkflowDefaults<'a> {
    pub(crate) namespace: &'a str,
    pub(crate) identity: &'a str,
}

pub(crate) struct QueryWorkflowDefaults<'a> {
    pub(crate) namespace: &'a str,
}

pub(crate) struct TerminateWorkflowDefaults<'a> {
    pub(crate) namespace: &'a str,
    pub(crate) identity: &'a str,
}

pub(crate) struct StartWorkflowResponseInfo {
    pub(crate) workflow_id: String,
    pub(crate) namespace: String,
}

pub(crate) fn build_start_workflow_request(
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
        workflow_type: Some(WorkflowType {
            name: workflow_type,
        }),
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
            request.search_attributes = Some(SearchAttributes {
                indexed_fields: fields,
            });
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

pub(crate) fn build_terminate_workflow_request(
    payload: TerminateWorkflowRequestPayload,
    defaults: TerminateWorkflowDefaults,
) -> Result<TerminateWorkflowExecutionRequest, BridgeError> {
    let TerminateWorkflowRequestPayload {
        namespace,
        workflow_id,
        run_id,
        first_execution_run_id,
        reason,
        details,
    } = payload;

    let namespace = namespace.unwrap_or_else(|| defaults.namespace.to_string());

    let mut request = TerminateWorkflowExecutionRequest {
        namespace,
        identity: defaults.identity.to_string(),
        workflow_execution: Some(WorkflowExecution {
            workflow_id,
            run_id: run_id.unwrap_or_default(),
        }),
        reason: reason.unwrap_or_default(),
        first_execution_run_id: first_execution_run_id.unwrap_or_default(),
        ..Default::default()
    };

    if let Some(values) = details {
        request.details = Some(encode_payloads_from_vec(values)?);
    }

    Ok(request)
}

pub(crate) fn build_signal_with_start_request(
    payload: SignalWithStartRequestPayload,
    defaults: StartWorkflowDefaults,
) -> Result<
    (
        SignalWithStartWorkflowExecutionRequest,
        StartWorkflowResponseInfo,
    ),
    BridgeError,
> {
    let SignalWithStartRequestPayload {
        start,
        signal_name,
        signal_args,
    } = payload;

    let (mut start_request, response_info) = build_start_workflow_request(start, defaults)?;

    let mut request = SignalWithStartWorkflowExecutionRequest {
        namespace: response_info.namespace.clone(),
        workflow_id: response_info.workflow_id.clone(),
        signal_name,
        ..Default::default()
    };

    request.workflow_type = start_request.workflow_type.take();
    request.task_queue = start_request.task_queue.take();
    request.input = start_request.input.take();
    request.identity = take(&mut start_request.identity);
    request.request_id = take(&mut start_request.request_id);
    request.workflow_execution_timeout = start_request.workflow_execution_timeout.take();
    request.workflow_run_timeout = start_request.workflow_run_timeout.take();
    request.workflow_task_timeout = start_request.workflow_task_timeout.take();
    request.retry_policy = start_request.retry_policy.take();
    request.memo = start_request.memo.take();
    request.search_attributes = start_request.search_attributes.take();
    request.header = start_request.header.take();
    request.cron_schedule = take(&mut start_request.cron_schedule);

    let mut encoded_signal = Vec::with_capacity(signal_args.len());
    for value in signal_args {
        encoded_signal.push(encode_payload(value)?);
    }
    request.signal_input = Some(Payloads {
        payloads: encoded_signal,
    });

    Ok((request, response_info))
}

pub(crate) fn build_query_workflow_request(
    payload: QueryWorkflowRequestPayload,
    defaults: QueryWorkflowDefaults,
) -> Result<QueryWorkflowRequest, BridgeError> {
    let QueryWorkflowRequestPayload {
        namespace,
        workflow_id,
        run_id,
        first_execution_run_id: _,
        query_name,
        args,
    } = payload;

    if workflow_id.trim().is_empty() {
        return Err(BridgeError::InvalidRequest(
            "workflow_id cannot be empty for query".to_string(),
        ));
    }

    if query_name.trim().is_empty() {
        return Err(BridgeError::InvalidRequest(
            "query_name cannot be empty".to_string(),
        ));
    }

    let namespace = namespace.unwrap_or_else(|| defaults.namespace.to_string());

    let mut encoded_args = Vec::new();
    if let Some(values) = args {
        for value in values {
            encoded_args.push(encode_payload(value)?);
        }
    }

    let query = WorkflowQuery {
        query_type: query_name,
        query_args: Some(Payloads {
            payloads: encoded_args,
        }),
        header: None,
    };

    let execution = WorkflowExecution {
        workflow_id,
        run_id: run_id.unwrap_or_default(),
    };

    Ok(QueryWorkflowRequest {
        namespace,
        execution: Some(execution),
        query: Some(query),
        query_reject_condition: QueryRejectCondition::None as i32,
    })
}

pub(crate) fn decode_query_result(
    payloads: Option<Payloads>,
) -> Result<serde_json::Value, BridgeError> {
    match payloads {
        Some(payloads) => {
            let mut values = Vec::with_capacity(payloads.payloads.len());
            for payload in payloads.payloads {
                values.push(decode_payload(payload)?);
            }

            match values.len() {
                0 => Ok(serde_json::Value::Null),
                1 => Ok(values.into_iter().next().unwrap()),
                _ => Ok(serde_json::Value::Array(values)),
            }
        }
        None => Ok(serde_json::Value::Null),
    }
}

pub(crate) fn json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, BridgeError> {
    serde_json::to_vec(value).map_err(|err| BridgeError::ResponseEncode(err.to_string()))
}

fn encode_payload(value: Value) -> Result<Payload, BridgeError> {
    let data =
        serde_json::to_vec(&value).map_err(|err| BridgeError::PayloadEncode(err.to_string()))?;
    let mut metadata = HashMap::new();
    metadata.insert("encoding".to_string(), b"json/plain".to_vec());
    Ok(Payload { metadata, data })
}

fn encode_payloads_from_vec(values: Vec<Value>) -> Result<Payloads, BridgeError> {
    let mut encoded = Vec::with_capacity(values.len());
    for value in values {
        encoded.push(encode_payload(value)?);
    }
    Ok(Payloads { payloads: encoded })
}

fn encode_payload_map(
    map: Option<HashMap<String, Value>>,
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

fn decode_payload(payload: Payload) -> Result<Value, BridgeError> {
    let encoding = payload
        .metadata
        .get("encoding")
        .map(|bytes| String::from_utf8_lossy(bytes).to_string())
        .ok_or_else(|| {
            BridgeError::ResponseEncode("missing payload encoding metadata".to_string())
        })?;

    if !encoding.to_ascii_lowercase().contains("json") {
        return Err(BridgeError::ResponseEncode(format!(
            "unsupported payload encoding: {encoding}",
        )));
    }

    serde_json::from_slice(&payload.data)
        .map_err(|err| BridgeError::ResponseEncode(err.to_string()))
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
    use serde_json::json;

    #[test]
    fn encode_payload_map_returns_none_for_empty_maps() {
        let encoded = encode_payload_map(Some(HashMap::new())).expect("encode succeeds");
        assert!(encoded.is_none());
    }

    #[test]
    fn duration_from_millis_converts_components() {
        let duration = duration_from_millis(1_234);
        assert_eq!(duration.seconds, 1);
        assert_eq!(duration.nanos, 234_000_000);
    }

    #[test]
    fn decode_query_result_flattens_single_element_arrays() {
        let payloads = Payloads {
            payloads: vec![encode_payload(json!({"key": "value"})).unwrap()],
        };

        let value = decode_query_result(Some(payloads)).expect("decode succeeds");
        assert_eq!(value, json!({"key": "value"}));
    }
}

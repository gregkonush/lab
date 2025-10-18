use super::*;
use base64::{engine::general_purpose, Engine as _};
use serde_json::json;
use std::collections::HashMap;
use std::net::TcpListener;
use std::sync::Arc;

#[test]
fn byte_array_new_round_trips_large_payload() {
    let _guard = byte_array::test_lock();
    byte_array::clear_pool();

    let len = 8 * 1024 * 1024;
    let mut payload = vec![0u8; len];
    for (idx, byte) in payload.iter_mut().enumerate() {
        *byte = (idx % 251) as u8;
    }

    let array_ptr = temporal_bun_byte_array_new(payload.as_ptr(), payload.len());
    assert!(!array_ptr.is_null());

    unsafe {
        let array = &*array_ptr;
        assert_eq!(array.len, payload.len());
        let slice = std::slice::from_raw_parts(array.ptr, array.len);
        assert_eq!(slice, payload.as_slice());
    }

    temporal_bun_byte_array_free(array_ptr);
    assert_eq!(byte_array::pool_len(), 1);
}

#[test]
fn byte_array_new_reuses_pooled_buffers() {
    let _guard = byte_array::test_lock();
    byte_array::clear_pool();
    assert_eq!(byte_array::pool_len(), 0);

    let payload_a = vec![1u8; 1024];
    let array_a = temporal_bun_byte_array_new(payload_a.as_ptr(), payload_a.len());
    let (ptr_a, cap_a) = unsafe {
        let array = &*array_a;
        (array.ptr, array.cap)
    };
    temporal_bun_byte_array_free(array_a);
    assert_eq!(byte_array::pool_len(), 1);

    let payload_b = vec![2u8; payload_a.len()];
    let array_b = temporal_bun_byte_array_new(payload_b.as_ptr(), payload_b.len());
    let (ptr_b, cap_b) = unsafe {
        let array = &*array_b;
        (array.ptr, array.cap)
    };
    assert_eq!(byte_array::pool_len(), 0);
    assert_eq!(ptr_a, ptr_b);
    assert_eq!(cap_a, cap_b);

    temporal_bun_byte_array_free(array_b);
    assert_eq!(byte_array::pool_len(), 1);
}

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
        client_cert_pair: None,
    };

    let tls = metadata::tls_config_from_payload(payload).expect("parsed tls config");
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
        client_cert_pair: None,
    };

    let err = metadata::tls_config_from_payload(payload).unwrap_err();
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

    let defaults = request::StartWorkflowDefaults {
        namespace: "default",
        identity: "worker-1",
    };

    let (request, info) =
        request::build_start_workflow_request(payload, defaults).expect("build request");
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

    let defaults = request::StartWorkflowDefaults {
        namespace: "default",
        identity: "worker-1",
    };

    let (request, info) =
        request::build_start_workflow_request(payload, defaults).expect("build request");

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

#[test]
fn build_terminate_workflow_request_applies_defaults() {
    let payload = TerminateWorkflowRequestPayload {
        namespace: None,
        workflow_id: "wf-terminate".to_string(),
        run_id: None,
        first_execution_run_id: None,
        reason: None,
        details: None,
    };

    let defaults = request::TerminateWorkflowDefaults {
        namespace: "default",
        identity: "worker-1",
    };

    let request = request::build_terminate_workflow_request(payload, defaults).expect("request");
    assert_eq!(request.namespace, "default");
    assert_eq!(request.identity, "worker-1");
    assert_eq!(request.reason, "");
    assert_eq!(request.first_execution_run_id, "");
    assert!(request.details.is_none());

    let execution = request.workflow_execution.expect("execution");
    assert_eq!(execution.workflow_id, "wf-terminate");
    assert_eq!(execution.run_id, "");
}

#[test]
fn build_terminate_workflow_request_encodes_reason_and_details() {
    let payload = TerminateWorkflowRequestPayload {
        namespace: Some("analytics".to_string()),
        workflow_id: "terminate-me".to_string(),
        run_id: Some("run-123".to_string()),
        first_execution_run_id: Some("run-initial".to_string()),
        reason: Some("done".to_string()),
        details: Some(vec![json!("cleanup"), json!({ "ok": true })]),
    };

    let defaults = request::TerminateWorkflowDefaults {
        namespace: "fallback",
        identity: "worker-2",
    };

    let request = request::build_terminate_workflow_request(payload, defaults).expect("request");
    assert_eq!(request.namespace, "analytics");
    assert_eq!(request.identity, "worker-2");
    assert_eq!(request.reason, "done");
    assert_eq!(request.first_execution_run_id, "run-initial");

    let execution = request.workflow_execution.expect("execution");
    assert_eq!(execution.workflow_id, "terminate-me");
    assert_eq!(execution.run_id, "run-123");

    let details = request.details.expect("details");
    let decoded: Vec<serde_json::Value> = details
        .payloads
        .iter()
        .map(|payload| serde_json::from_slice::<serde_json::Value>(&payload.data).expect("json"))
        .collect();
    assert_eq!(decoded, vec![json!("cleanup"), json!({ "ok": true })]);
    for payload in details.payloads {
        assert_eq!(
            payload.metadata.get("encoding"),
            Some(&b"json/plain".to_vec())
        );
    }
}

#[test]
fn temporal_bun_client_terminate_workflow_sets_error_for_invalid_handle() {
    let status = temporal_bun_client_terminate_workflow(std::ptr::null_mut(), std::ptr::null(), 0);
    assert_eq!(status, -1);

    let mut len: usize = 0;
    let ptr = error::take_error(&mut len as *mut usize);
    assert!(len > 0);
    assert!(!ptr.is_null());

    let message = unsafe { std::slice::from_raw_parts(ptr, len) };
    let message = std::str::from_utf8(message).expect("utf8");
    assert!(message.contains("invalid client handle"));

    unsafe {
        error::free_error(ptr as *mut u8, len);
    }
}

fn telemetry_runtime_handle() -> RuntimeHandle {
    let runtime =
        CoreRuntime::new(TelemetryOptions::default(), TokioRuntimeBuilder::default()).unwrap();
    RuntimeHandle {
        runtime: Arc::new(runtime),
        prometheus_abort: None,
        prometheus_config: None,
    }
}

fn telemetry_prometheus_payload(bind_address: &str) -> TelemetryUpdatePayload {
    TelemetryUpdatePayload {
        metrics: MetricsExporterPayload::Prometheus(PrometheusTelemetryPayload {
            bind_address: bind_address.to_string(),
            global_tags: HashMap::new(),
            counters_total_suffix: false,
            unit_suffix: false,
            use_seconds_for_durations: false,
            histogram_bucket_overrides: HashMap::new(),
        }),
    }
}

fn telemetry_otlp_payload(url: &str) -> TelemetryUpdatePayload {
    TelemetryUpdatePayload {
        metrics: MetricsExporterPayload::Otlp(OtlpTelemetryPayload {
            url: url.to_string(),
            protocol: None,
            headers: HashMap::new(),
            metric_periodicity_ms: None,
            metric_temporality: None,
            global_tags: HashMap::new(),
            use_seconds_for_durations: false,
            histogram_bucket_overrides: HashMap::new(),
        }),
    }
}

#[test]
fn telemetry_configuration_rejects_shared_runtime() {
    let mut handle = telemetry_runtime_handle();
    let _clone = handle.runtime.clone();

    let err = configure_runtime_telemetry(&mut handle, telemetry_prometheus_payload("127.0.0.1:0"))
        .unwrap_err();
    assert!(matches!(err, BridgeError::RuntimeInUse));
}

#[test]
fn telemetry_configuration_rejects_invalid_prometheus_address() {
    let mut handle = telemetry_runtime_handle();

    let err =
        configure_runtime_telemetry(&mut handle, telemetry_prometheus_payload("not-a-socket"))
            .unwrap_err();
    assert!(matches!(err, BridgeError::InvalidTelemetry(_)));
}

#[test]
fn telemetry_configuration_rejects_invalid_otlp_url() {
    let mut handle = telemetry_runtime_handle();

    let err = configure_runtime_telemetry(&mut handle, telemetry_otlp_payload("://collector"))
        .unwrap_err();
    assert!(matches!(err, BridgeError::InvalidTelemetry(_)));
}

#[test]
fn telemetry_configuration_starts_prometheus_exporter() {
    let mut handle = telemetry_runtime_handle();

    configure_runtime_telemetry(&mut handle, telemetry_prometheus_payload("127.0.0.1:0")).unwrap();
    assert!(handle.prometheus_abort.is_some());

    if let Some(task) = handle.prometheus_abort.take() {
        task.abort();
    }
}

#[test]
fn telemetry_configuration_rolls_back_on_prometheus_error() {
    let mut handle = telemetry_runtime_handle();
    configure_runtime_telemetry(&mut handle, telemetry_prometheus_payload("127.0.0.1:0")).unwrap();
    let previous_config = handle.prometheus_config.clone();
    assert!(handle.prometheus_abort.is_some());

    let blocker = TcpListener::bind("127.0.0.1:0").expect("bind listener");
    let blocked_addr = blocker.local_addr().expect("listener addr").to_string();

    let err = configure_runtime_telemetry(&mut handle, telemetry_prometheus_payload(&blocked_addr))
        .unwrap_err();
    assert!(matches!(err, BridgeError::TelemetryConfiguration(_)));

    assert!(handle.prometheus_abort.is_some());
    assert_eq!(
        handle
            .prometheus_config
            .as_ref()
            .map(|cfg| cfg.bind_address.as_str()),
        previous_config
            .as_ref()
            .map(|cfg| cfg.bind_address.as_str())
    );

    if let Some(task) = handle.prometheus_abort.take() {
        task.abort();
    }
}

#[test]
fn normalize_metadata_headers_lowercases_and_extracts_bearer() {
    let headers = HashMap::from([
        (
            String::from("Authorization"),
            String::from(" Bearer super-secret "),
        ),
        (String::from("X-Custom"), String::from(" value ")),
    ]);

    let (normalized, bearer) =
        metadata::normalize_metadata_headers(headers).expect("headers normalized");

    assert_eq!(normalized.get("x-custom"), Some(&"value".to_string()));
    assert!(!normalized.contains_key("authorization"));
    assert_eq!(bearer.as_deref(), Some("super-secret"));
}

#[test]
fn normalize_metadata_headers_preserves_non_bearer_authorization() {
    let headers = HashMap::from([(String::from("Authorization"), String::from("Basic abc"))]);

    let (normalized, bearer) =
        metadata::normalize_metadata_headers(headers).expect("headers normalized");

    assert_eq!(
        normalized.get("authorization"),
        Some(&"Basic abc".to_string())
    );
    assert_eq!(bearer, None);
}

#[test]
fn normalize_metadata_headers_rejects_invalid_input() {
    let dup_headers = HashMap::from([
        (String::from("Foo"), String::from("one")),
        (String::from("foo"), String::from("two")),
    ]);
    let duplicate_err = metadata::normalize_metadata_headers(dup_headers).unwrap_err();
    assert!(matches!(
        duplicate_err,
        BridgeError::InvalidMetadata(message) if message.contains("duplicate header key")
    ));

    let empty_key = HashMap::from([(String::from("   "), String::from("value"))]);
    let err = metadata::normalize_metadata_headers(empty_key).unwrap_err();
    assert!(matches!(
        err,
        BridgeError::InvalidMetadata(message) if message.contains("non-empty")
    ));

    let empty_value = HashMap::from([(String::from("auth"), String::from("   "))]);
    let err = metadata::normalize_metadata_headers(empty_value).unwrap_err();
    assert!(matches!(
        err,
        BridgeError::InvalidMetadata(message)
            if message.contains("must have a non-empty value")
    ));
}

#[test]
fn extract_bearer_token_handles_case_insensitive_scheme() {
    assert_eq!(metadata::extract_bearer_token("Bearer abc"), Some("abc"));
    assert_eq!(metadata::extract_bearer_token("bearer  abc"), Some("abc"));
    assert_eq!(metadata::extract_bearer_token("Basic abc"), None);
    assert_eq!(metadata::extract_bearer_token("Bearer   "), None);
}

#[test]
fn build_signal_with_start_request_merges_components() {
    let payload = SignalWithStartRequestPayload {
        start: StartWorkflowRequestPayload {
            namespace: Some("custom".to_string()),
            workflow_id: "wf-789".to_string(),
            workflow_type: "SampleWorkflow".to_string(),
            task_queue: "primary".to_string(),
            args: Some(vec![json!("payload")]),
            memo: None,
            search_attributes: None,
            headers: None,
            cron_schedule: Some("0 * * * *".to_string()),
            request_id: Some("req-123".to_string()),
            identity: Some("client-id".to_string()),
            workflow_execution_timeout_ms: Some(1_000),
            workflow_run_timeout_ms: Some(2_000),
            workflow_task_timeout_ms: Some(500),
            retry_policy: Some(RetryPolicyPayload {
                initial_interval_ms: Some(500),
                ..Default::default()
            }),
        },
        signal_name: "notify".to_string(),
        signal_args: vec![json!({"event": "start"})],
    };

    let defaults = request::StartWorkflowDefaults {
        namespace: "default",
        identity: "default-id",
    };

    let (request, info) =
        request::build_signal_with_start_request(payload, defaults).expect("built request");

    assert_eq!(info.workflow_id, "wf-789");
    assert_eq!(info.namespace, "custom");
    assert_eq!(request.namespace, "custom");
    assert_eq!(request.workflow_id, "wf-789");
    assert_eq!(request.signal_name, "notify");
    assert_eq!(request.identity, "client-id");
    assert_eq!(request.request_id, "req-123");
    assert_eq!(request.cron_schedule, "0 * * * *");

    let start_payloads = request.input.expect("start payloads").payloads;
    assert_eq!(start_payloads.len(), 1);
    let start_value: serde_json::Value =
        serde_json::from_slice(&start_payloads[0].data).expect("decode start payload");
    assert_eq!(start_value, json!("payload"));

    let signal_payloads = request.signal_input.expect("signal payloads").payloads;
    assert_eq!(signal_payloads.len(), 1);
    let signal_value: serde_json::Value =
        serde_json::from_slice(&signal_payloads[0].data).expect("decode signal payload");
    assert_eq!(signal_value, json!({"event": "start"}));

    let execution_timeout = request
        .workflow_execution_timeout
        .expect("execution timeout");
    assert_eq!(execution_timeout.seconds, 1);
    assert_eq!(execution_timeout.nanos, 0);

    let run_timeout = request.workflow_run_timeout.expect("run timeout");
    assert_eq!(run_timeout.seconds, 2);
    assert_eq!(run_timeout.nanos, 0);

    let task_timeout = request.workflow_task_timeout.expect("task timeout");
    assert_eq!(task_timeout.seconds, 0);
    assert_eq!(task_timeout.nanos, 500_000_000);

    let retry = request.retry_policy.expect("retry policy");
    let initial_interval = retry.initial_interval.expect("initial interval");
    assert_eq!(initial_interval.seconds, 0);
    assert_eq!(initial_interval.nanos, 500_000_000);
}

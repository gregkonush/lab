import type {
  RetryPolicyOptions,
  SignalWithStartOptions,
  StartWorkflowOptions,
  TerminateWorkflowOptions,
  WorkflowHandle,
} from './types'

const DOCS_ROOT = 'packages/temporal-bun-sdk/docs'
const FFI_SURFACE_DOC = `${DOCS_ROOT}/ffi-surface.md`
const CLIENT_RUNTIME_DOC = `${DOCS_ROOT}/client-runtime.md`

const notImplemented = (feature: string, docPath: string): never => {
  throw new Error(`${feature} is not implemented yet. See ${docPath} for the step-by-step plan.`)
}

const normalizeArgs = (args?: unknown[]): unknown[] => (Array.isArray(args) ? args : [])

const buildRetryPolicyPayload = (policy: RetryPolicyOptions | undefined): Record<string, unknown> | undefined => {
  if (!policy) return undefined

  const payload: Record<string, unknown> = {}

  if (policy.initialIntervalMs !== undefined) {
    payload.initial_interval_ms = policy.initialIntervalMs
  }
  if (policy.maximumIntervalMs !== undefined) {
    payload.maximum_interval_ms = policy.maximumIntervalMs
  }
  if (policy.maximumAttempts !== undefined) {
    payload.maximum_attempts = policy.maximumAttempts
  }
  if (policy.backoffCoefficient !== undefined) {
    payload.backoff_coefficient = policy.backoffCoefficient
  }
  if (policy.nonRetryableErrorTypes?.length) {
    payload.non_retryable_error_types = policy.nonRetryableErrorTypes
  }

  return payload
}

export const buildSignalRequest = ({
  handle,
  signalName,
  args,
  defaults,
}: {
  handle: WorkflowHandle
  signalName: string
  args: unknown[]
  defaults?: { identity?: string }
}): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    namespace: handle.namespace,
    workflow_id: handle.workflowId,
    signal_name: signalName,
    args: normalizeArgs(args),
  }

  if (handle.runId) {
    payload.run_id = handle.runId
  }

  if (handle.firstExecutionRunId) {
    payload.first_execution_run_id = handle.firstExecutionRunId
  }

  if (defaults?.identity) {
    payload.identity = defaults.identity
  }

  return payload
}

export const buildQueryRequest = (
  handle: WorkflowHandle,
  queryName: string,
  args: unknown[],
): Record<string, unknown> => {
  void handle
  void queryName
  void args
  // TODO(codex): Encode workflow query payloads and headers per ${CLIENT_RUNTIME_DOC} §3 before invoking the native bridge.
  return notImplemented('Workflow query serialization', CLIENT_RUNTIME_DOC)
}

export const buildTerminateRequest = (
  handle: WorkflowHandle,
  options: TerminateWorkflowOptions,
): Record<string, unknown> => {
  void handle
  void options
  // TODO(codex): Map terminate options into the FFI payload expected by `temporal_bun_client_terminate_workflow`
  // (see ${FFI_SURFACE_DOC}, Client exports table).
  return notImplemented('Workflow terminate serialization', FFI_SURFACE_DOC)
}

export const buildCancelRequest = (handle: WorkflowHandle): Record<string, unknown> => {
  void handle
  // TODO(codex): Emit cancellation payloads for `temporal_bun_client_cancel_workflow` per ${FFI_SURFACE_DOC}.
  return notImplemented('Workflow cancel serialization', FFI_SURFACE_DOC)
}

export const buildSignalWithStartRequest = ({
  options,
  defaults,
}: {
  options: SignalWithStartOptions
  defaults: { namespace: string; identity: string; taskQueue: string }
}): Record<string, unknown> => {
  void options
  void defaults
  // TODO(codex): Combine start and signal payloads into the JSON envelope described in ${CLIENT_RUNTIME_DOC} §3.
  return notImplemented('Signal-with-start serialization', CLIENT_RUNTIME_DOC)
}

export const buildStartWorkflowPayload = ({
  options,
  defaults,
}: {
  options: StartWorkflowOptions
  defaults: { namespace: string; identity: string; taskQueue: string }
}): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    namespace: options.namespace ?? defaults.namespace,
    workflow_id: options.workflowId,
    workflow_type: options.workflowType,
    task_queue: options.taskQueue ?? defaults.taskQueue,
    identity: options.identity ?? defaults.identity,
    args: normalizeArgs(options.args),
  }

  if (options.cronSchedule) {
    payload.cron_schedule = options.cronSchedule
  }

  if (options.memo) {
    payload.memo = options.memo
  }

  if (options.headers) {
    payload.headers = options.headers
  }

  if (options.searchAttributes) {
    payload.search_attributes = options.searchAttributes
  }

  if (options.requestId) {
    payload.request_id = options.requestId
  }

  if (options.workflowExecutionTimeoutMs !== undefined) {
    payload.workflow_execution_timeout_ms = options.workflowExecutionTimeoutMs
  }

  if (options.workflowRunTimeoutMs !== undefined) {
    payload.workflow_run_timeout_ms = options.workflowRunTimeoutMs
  }

  if (options.workflowTaskTimeoutMs !== undefined) {
    payload.workflow_task_timeout_ms = options.workflowTaskTimeoutMs
  }

  const retryPolicyPayload = buildRetryPolicyPayload(options.retryPolicy)
  if (retryPolicyPayload) {
    payload.retry_policy = retryPolicyPayload
  }

  return payload
}

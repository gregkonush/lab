export interface WorkflowHandle {
  workflowId: string
  runId?: string
  firstExecutionRunId?: string
  namespace: string
}

export interface RetryPolicyOptions {
  initialIntervalMs?: number
  maximumIntervalMs?: number
  maximumAttempts?: number
  backoffCoefficient?: number
  nonRetryableErrorTypes?: string[]
}

export interface StartWorkflowOptions {
  workflowId: string
  workflowType: string
  args?: unknown[]
  taskQueue?: string
  namespace?: string
  identity?: string
  cronSchedule?: string
  memo?: Record<string, unknown>
  headers?: Record<string, unknown>
  searchAttributes?: Record<string, unknown>
  requestId?: string
  workflowExecutionTimeoutMs?: number
  workflowRunTimeoutMs?: number
  workflowTaskTimeoutMs?: number
  retryPolicy?: RetryPolicyOptions
}

export interface TerminateWorkflowOptions {
  reason?: string
  details?: unknown[]
  firstExecutionRunId?: string
  runId?: string
}

export interface SignalWithStartOptions extends StartWorkflowOptions {
  signalName: string
  signalArgs?: unknown[]
}

import { describe, expect, test } from 'bun:test'
import { buildSignalWithStartRequest, buildStartWorkflowRequest } from './serialization'

describe('buildSignalWithStartRequest', () => {
  test('merges defaults with signal payload', () => {
    const request = buildSignalWithStartRequest({
      options: {
        workflowId: 'example-workflow',
        workflowType: 'ExampleWorkflow',
        signalName: 'example-signal',
        signalArgs: [{ hello: 'world' }, 42],
      },
      defaults: {
        namespace: 'default',
        identity: 'client-123',
        taskQueue: 'primary',
      },
    })

    expect(request).toEqual({
      namespace: 'default',
      workflow_id: 'example-workflow',
      workflow_type: 'ExampleWorkflow',
      task_queue: 'primary',
      identity: 'client-123',
      args: [],
      signal_name: 'example-signal',
      signal_args: [{ hello: 'world' }, 42],
    })
  })
})

describe('buildStartWorkflowRequest', () => {
  test('applies optional fields with snake_case keys', () => {
    const request = buildStartWorkflowRequest({
      options: {
        workflowId: 'wf-1',
        workflowType: 'ExampleWorkflow',
        args: ['foo'],
        namespace: 'custom',
        identity: 'custom-identity',
        taskQueue: 'custom-queue',
        cronSchedule: '* * * * *',
        memo: { note: 'hello' },
        headers: { headerKey: 'headerValue' },
        searchAttributes: { CustomIntField: 10 },
        requestId: 'req-123',
        workflowExecutionTimeoutMs: 60000,
        workflowRunTimeoutMs: 120000,
        workflowTaskTimeoutMs: 30000,
        retryPolicy: {
          initialIntervalMs: 1000,
          maximumIntervalMs: 10000,
          maximumAttempts: 5,
          backoffCoefficient: 2,
          nonRetryableErrorTypes: ['FatalError'],
        },
      },
      defaults: {
        namespace: 'default',
        identity: 'default-identity',
        taskQueue: 'primary',
      },
    })

    expect(request).toMatchObject({
      namespace: 'custom',
      workflow_id: 'wf-1',
      workflow_type: 'ExampleWorkflow',
      task_queue: 'custom-queue',
      identity: 'custom-identity',
      args: ['foo'],
      cron_schedule: '* * * * *',
      memo: { note: 'hello' },
      headers: { headerKey: 'headerValue' },
      search_attributes: { CustomIntField: 10 },
      request_id: 'req-123',
      workflow_execution_timeout_ms: 60000,
      workflow_run_timeout_ms: 120000,
      workflow_task_timeout_ms: 30000,
      retry_policy: {
        initial_interval_ms: 1000,
        maximum_interval_ms: 10000,
        maximum_attempts: 5,
        backoff_coefficient: 2,
        non_retryable_error_types: ['FatalError'],
      },
    })
  })

  test('falls back to defaults when optional fields omitted', () => {
    const request = buildStartWorkflowRequest({
      options: {
        workflowId: 'wf-2',
        workflowType: 'ExampleWorkflow',
      },
      defaults: {
        namespace: 'default',
        identity: 'default-identity',
        taskQueue: 'primary',
      },
    })

    expect(request).toEqual({
      namespace: 'default',
      workflow_id: 'wf-2',
      workflow_type: 'ExampleWorkflow',
      task_queue: 'primary',
      identity: 'default-identity',
      args: [],
    })
  })
})

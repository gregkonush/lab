import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

mock.module('../src/internal/core-bridge/native.ts', () => {
  const stubRuntime = { type: 'runtime' as const, handle: 1 }
  const stubClient = { type: 'client' as const, handle: 2 }
  const stub = {
    createRuntime: () => stubRuntime,
    runtimeShutdown: () => {},
    createClient: async () => stubClient,
    clientShutdown: () => {},
    startWorkflow: async () => new Uint8Array(),
    describeNamespace: async () => new Uint8Array(),
    signalWorkflow: async () => {},
    queryWorkflow: async () => new Uint8Array(),
    terminateWorkflow: async () => {},
    cancelWorkflow: async () => {},
    signalWithStart: async () => new Uint8Array(),
  }
  return { native: stub }
})

const { createTemporalClient } = await import('../src/client.ts')
const { native } = await import('../src/internal/core-bridge/native.ts')
import type { TemporalConfig } from '../src/config'

const encodeJson = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value))

describe('temporal client (native bridge)', () => {
  const original = {
    createRuntime: native.createRuntime,
    runtimeShutdown: native.runtimeShutdown,
    createClient: native.createClient,
    clientShutdown: native.clientShutdown,
    startWorkflow: native.startWorkflow,
    describeNamespace: native.describeNamespace,
    signalWorkflow: native.signalWorkflow,
  }

  const runtimeHandle = { type: 'runtime', handle: 101 } as const
  const clientHandle = { type: 'client', handle: 202 } as const

  beforeEach(() => {
    native.createRuntime = mock(() => runtimeHandle)
    native.createClient = mock(async () => clientHandle)
    native.clientShutdown = mock(() => {})
    native.runtimeShutdown = mock(() => {})
    native.describeNamespace = mock(async () => new Uint8Array())
    native.signalWorkflow = mock(async () => {})
  })

  afterEach(() => {
    Object.assign(native, original)
  })

  test('startWorkflow forwards defaults and parses response', async () => {
    const startWorkflowMock = mock(async (_: unknown, payload: Record<string, unknown>) => {
      expect(payload.workflow_id).toBe('workflow-123')
      expect(payload.workflow_type).toBe('ExampleWorkflow')
      expect(payload.namespace).toBe('analytics')
      expect(payload.task_queue).toBe('prix')
      expect(payload.identity).toBe('bun-worker-01')
      expect(payload.args).toEqual(['hello', 42])
      return encodeJson({ runId: 'run-xyz', workflowId: payload.workflow_id, namespace: payload.namespace })
    })

    native.startWorkflow = startWorkflowMock

    const config: TemporalConfig = {
      host: '127.0.0.1',
      port: 7233,
      address: '127.0.0.1:7233',
      namespace: 'default',
      taskQueue: 'prix',
      apiKey: undefined,
      tls: undefined,
      allowInsecureTls: false,
      workerIdentity: 'bun-worker-01',
      workerIdentityPrefix: 'temporal-bun-worker',
    }

    const { client } = await createTemporalClient({
      config,
      namespace: 'analytics',
    })

    const result = await client.workflow.start({
      workflowId: 'workflow-123',
      workflowType: 'ExampleWorkflow',
      args: ['hello', 42],
    })

    expect(result).toEqual({ runId: 'run-xyz', workflowId: 'workflow-123', namespace: 'analytics' })
    expect(startWorkflowMock).toHaveBeenCalledTimes(1)

    await client.shutdown()
    expect(native.clientShutdown).toHaveBeenCalledTimes(1)
    expect(native.runtimeShutdown).toHaveBeenCalledTimes(1)
  })

  test('startWorkflow builds retry policy payload', async () => {
    let captured: Record<string, unknown> | undefined
    native.startWorkflow = mock(async (_: unknown, payload: Record<string, unknown>) => {
      captured = payload
      return encodeJson({ runId: 'run-abc', workflowId: payload.workflow_id, namespace: payload.namespace })
    })

    const config: TemporalConfig = {
      host: 'localhost',
      port: 7233,
      address: 'localhost:7233',
      namespace: 'default',
      taskQueue: 'prix',
      apiKey: undefined,
      tls: undefined,
      allowInsecureTls: false,
      workerIdentity: 'worker-default',
      workerIdentityPrefix: 'temporal-bun-worker',
    }

    const { client } = await createTemporalClient({ config })

    await client.startWorkflow({
      workflowId: 'wf-id',
      workflowType: 'Example',
      retryPolicy: {
        initialIntervalMs: 1_000,
        maximumIntervalMs: 10_000,
        maximumAttempts: 5,
        backoffCoefficient: 2,
        nonRetryableErrorTypes: ['FatalError'],
      },
    })

    expect(captured?.retry_policy).toEqual({
      initial_interval_ms: 1_000,
      maximum_interval_ms: 10_000,
      maximum_attempts: 5,
      backoff_coefficient: 2,
      non_retryable_error_types: ['FatalError'],
    })

    await client.shutdown()
  })

  test('createTemporalClient forwards TLS and API key options to native bridge', async () => {
    native.startWorkflow = mock(async (_: unknown, payload: Record<string, unknown>) => {
      return encodeJson({ runId: 'run-123', workflowId: payload.workflow_id, namespace: payload.namespace })
    })

    const config: TemporalConfig = {
      host: 'temporal.internal',
      port: 7233,
      address: 'temporal.internal:7233',
      namespace: 'default',
      taskQueue: 'prix',
      apiKey: 'test-key',
      allowInsecureTls: false,
      workerIdentity: 'bun-worker',
      workerIdentityPrefix: 'temporal-bun-worker',
      tls: {
        serverRootCACertificate: Buffer.from('ROOT'),
        serverNameOverride: 'temporal.example.internal',
        clientCertPair: {
          crt: Buffer.from('CERT'),
          key: Buffer.from('KEY'),
        },
      },
    }

    await createTemporalClient({ config })

    expect(native.createClient).toHaveBeenLastCalledWith(runtimeHandle, {
      address: 'https://temporal.internal:7233',
      namespace: 'default',
      identity: 'bun-worker',
      apiKey: 'test-key',
      tls: {
        server_root_ca_cert: Buffer.from('ROOT').toString('base64'),
        client_cert: Buffer.from('CERT').toString('base64'),
        client_private_key: Buffer.from('KEY').toString('base64'),
        server_name_override: 'temporal.example.internal',
      },
    })
  })

  test('signalWorkflow forwards handle context and identity defaults', async () => {
    const config: TemporalConfig = {
      host: '127.0.0.1',
      port: 7233,
      address: '127.0.0.1:7233',
      namespace: 'default',
      taskQueue: 'prix',
      apiKey: undefined,
      tls: undefined,
      allowInsecureTls: false,
      workerIdentity: 'bun-worker-01',
      workerIdentityPrefix: 'temporal-bun-worker',
    }

    const { client } = await createTemporalClient({ config, namespace: 'analytics' })

    const handle = {
      workflowId: 'workflow-abc',
      namespace: 'analytics',
      runId: 'run-xyz',
      firstExecutionRunId: 'run-initial',
    } as const

    await client.workflow.signal(handle, 'updateStatus', { status: 'ok' })

    expect(native.signalWorkflow).toHaveBeenCalledTimes(1)
    const signalWorkflowMock = native.signalWorkflow as ReturnType<typeof mock>
    const [_clientHandle, request] = signalWorkflowMock.mock.calls[0]
    expect(request).toEqual({
      namespace: 'analytics',
      workflow_id: 'workflow-abc',
      signal_name: 'updateStatus',
      args: [{ status: 'ok' }],
      identity: 'bun-worker-01',
      run_id: 'run-xyz',
      first_execution_run_id: 'run-initial',
    })

    await client.shutdown()
  })
})

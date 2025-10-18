import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { buildSignalRequest, buildStartWorkflowPayload } from '../src/client/serialization.ts'
import type { WorkflowHandle } from '../src/client/types.ts'
import { native } from '../src/internal/core-bridge/native.ts'

const shouldRun = process.env.TEMPORAL_TEST_SERVER === '1'

const suite = shouldRun ? describe : describe.skip

suite('native bridge integration', () => {
  let runtime: ReturnType<typeof native.createRuntime>

  beforeAll(() => {
    runtime = native.createRuntime({})
  })

  afterAll(() => {
    native.runtimeShutdown(runtime)
  })

  test('describe namespace succeeds against live Temporal server', async () => {
    const maxAttempts = 10
    const waitMs = 500

    const client = await withRetry(
      async () => {
        return native.createClient(runtime, {
          address: 'http://127.0.0.1:7233',
          namespace: 'default',
        })
      },
      maxAttempts,
      waitMs,
    )

    try {
      const responseBytes = await withRetry(() => native.describeNamespace(client, 'default'), maxAttempts, waitMs)
      expect(responseBytes.byteLength).toBeGreaterThan(0)
    } finally {
      native.clientShutdown(client)
    }
  })

  test('start workflow and send signal against live Temporal server', async () => {
    const maxAttempts = 10
    const waitMs = 500

    const client = await withRetry(
      async () =>
        native.createClient(runtime, {
          address: 'http://127.0.0.1:7233',
          namespace: 'default',
          identity: 'integration-test-client',
        }),
      maxAttempts,
      waitMs,
    )

    try {
      const startRequest = buildStartWorkflowPayload({
        options: {
          workflowId: `signal-${crypto.randomUUID()}`,
          workflowType: 'helloTemporal',
        },
        defaults: {
          namespace: 'default',
          identity: 'integration-test-client',
          taskQueue: 'integration-task-queue',
        },
      })

      const responseBytes = await native.startWorkflow(client, startRequest)
      const startResponse = JSON.parse(new TextDecoder().decode(responseBytes)) as {
        workflowId: string
        runId: string
        namespace: string
      }

      const handle: WorkflowHandle = {
        workflowId: startResponse.workflowId,
        runId: startResponse.runId,
        namespace: startResponse.namespace,
      }

      const signalRequest = buildSignalRequest({
        handle,
        signalName: 'integration-signal',
        args: [{ payload: 'ping' }],
        defaults: { identity: 'integration-test-client' },
      })

      await withRetry(() => native.signalWorkflow(client, signalRequest), maxAttempts, waitMs)
    } finally {
      native.clientShutdown(client)
    }
  })
})

async function withRetry<T>(fn: () => T | Promise<T>, attempts: number, waitMs: number): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
      await Bun.sleep(waitMs)
    }
  }
  throw lastError
}

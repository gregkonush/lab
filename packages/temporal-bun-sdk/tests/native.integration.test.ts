import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
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
      const responseJson = await withRetry(() => native.describeNamespace(client, 'default'), maxAttempts, waitMs)
      const namespaceInfo = JSON.parse(responseJson) as {
        namespace_info?: { name?: string }
      }
      expect(namespaceInfo.namespace_info?.name).toBe('default')

      const workflowId = `bun-native-${crypto.randomUUID?.() ?? Date.now().toString(36)}`
      const startResponseJson = await withRetry(
        () =>
          native.startWorkflow(client, {
            namespace: 'default',
            workflow_id: workflowId,
            workflow_type: 'integration-test-workflow',
            task_queue: 'prix',
          }),
        maxAttempts,
        waitMs,
      )

      const startResponse = JSON.parse(startResponseJson) as {
        run_id?: string
        workflow_id?: string
      }

      expect(startResponse.workflow_id).toBe(workflowId)
      expect(typeof startResponse.run_id).toBe('string')

      const signalResponseJson = await withRetry(
        () =>
          native.signalWorkflow(client, {
            namespace: 'default',
            workflow_id: workflowId,
            run_id: startResponse.run_id,
            signal_name: 'integration-signal',
            args: [{ message: 'ping' }],
          }),
        maxAttempts,
        waitMs,
      )

      const signalResponse = JSON.parse(signalResponseJson) as {
        workflow_id?: string
        signal_name?: string
      }

      expect(signalResponse.workflow_id).toBe(workflowId)
      expect(signalResponse.signal_name).toBe('integration-signal')
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

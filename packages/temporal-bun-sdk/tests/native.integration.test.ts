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
      const responseBytes = await withRetry(() => native.describeNamespace(client, 'default'), maxAttempts, waitMs)
      expect(responseBytes.byteLength).toBeGreaterThan(0)
    } finally {
      native.clientShutdown(client)
    }
  })

  test('cancel workflow resolves for in-flight execution', async () => {
    const maxAttempts = 10
    const waitMs = 500
    const workflowId = `integration-cancel-${Date.now()}`
    const identity = 'bun-integration-test'

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
      const payload = {
        namespace: 'default',
        workflow_id: workflowId,
        workflow_type: 'TemporalTestWorkflow',
        task_queue: 'default',
        identity,
        args: [],
      }

      const responseBytes = await withRetry(() => native.startWorkflow(client, payload), maxAttempts, waitMs)
      const response = JSON.parse(new TextDecoder().decode(responseBytes)) as {
        runId: string
      }

      await withRetry(
        () =>
          native.cancelWorkflow(client, {
            namespace: 'default',
            workflow_id: workflowId,
            run_id: response.runId,
            identity,
          }),
        maxAttempts,
        waitMs,
      )
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

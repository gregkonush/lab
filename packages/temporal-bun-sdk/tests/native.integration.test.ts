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
    const client = native.createClient(runtime, {
      address: 'http://127.0.0.1:7233',
      namespace: 'default',
    })

    try {
      let responseBytes: Uint8Array | undefined
      const maxAttempts = 10

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          responseBytes = native.describeNamespace(client, 'default')
          break
        } catch (error) {
          if (attempt === maxAttempts) {
            throw error
          }
          await Bun.sleep(500)
        }
      }

      expect(responseBytes?.byteLength ?? 0).toBeGreaterThan(0)
    } finally {
      native.clientShutdown(client)
    }
  })
})

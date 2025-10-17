import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { native } from '../src/internal/core-bridge/native.ts'

const shouldRun = process.env.TEMPORAL_TEST_SERVER === '1'

describe('native bridge integration', () => {
  // Skip entire suite when Temporal server isn't available.
  if (!shouldRun) {
    test('skip describeNamespace when server unavailable', () => {
      expect(true).toBe(true)
    })
    return
  }

  let runtime: ReturnType<typeof native.createRuntime>

  beforeAll(() => {
    runtime = native.createRuntime({})
  })

  afterAll(() => {
    native.runtimeShutdown(runtime)
  })

  test('describe namespace succeeds against live Temporal server', () => {
    const client = native.createClient(runtime, {
      address: 'http://127.0.0.1:7233',
      namespace: 'default',
    })

    const responseBytes = native.describeNamespace(client, 'default')
    expect(responseBytes.byteLength).toBeGreaterThan(0)

    native.clientShutdown(client)
  })
})

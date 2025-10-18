import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { Client, createClient, normalizeTemporalAddress } from '../src/core-bridge/client.ts'
import { createRuntime } from '../src/core-bridge/runtime.ts'

const hasLiveServer = process.env.TEMPORAL_TEST_SERVER === '1'

describe('core bridge runtime wrapper', () => {
  test('shutdown is idempotent and prevents reuse', async () => {
    const runtime = createRuntime()
    await runtime.shutdown()
    await runtime.shutdown()
    expect(() => runtime.nativeHandle).toThrowError('Runtime has already been shut down')
  })
})

const integrationSuite = hasLiveServer ? describe : describe.skip

describe('core bridge client wrapper', () => {
  test('normalizes addresses without protocol', () => {
    expect(normalizeTemporalAddress('127.0.0.1:7233')).toBe('http://127.0.0.1:7233')
    expect(normalizeTemporalAddress('https://example.com:443')).toBe('https://example.com:443')
  })

  test('connect rejects when Temporal server is unreachable', async () => {
    const runtime = createRuntime()
    try {
      await expect(
        Client.connect(runtime, {
          address: '127.0.0.1:65532',
          namespace: 'default',
        }),
      ).rejects.toThrow()
    } finally {
      await runtime.shutdown()
    }
  })
})

integrationSuite('core bridge client integration', () => {
  let runtime: ReturnType<typeof createRuntime>

  beforeAll(() => {
    runtime = createRuntime()
  })

  afterAll(async () => {
    await runtime.shutdown()
  })

  test('describe namespace returns bytes from Temporal', async () => {
    const client = await createClient(runtime, {
      address: 'http://127.0.0.1:7233',
      namespace: 'default',
    })

    try {
      const response = await withRetry(() => client.describeNamespace('default'), 10, 500)
      expect(response.byteLength).toBeGreaterThan(0)
    } finally {
      await client.shutdown()
    }
  })

  test('client shutdown is idempotent', async () => {
    const client = await createClient(runtime, {
      address: 'http://127.0.0.1:7233',
      namespace: 'default',
    })

    await client.shutdown()
    await client.shutdown()
    await expect(client.describeNamespace('default')).rejects.toThrowError('Client has already been shut down')
  })
})

async function withRetry<T>(fn: () => Promise<T>, attempts: number, waitMs: number): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === attempts) {
        break
      }
      await Bun.sleep(waitMs)
    }
  }
  throw lastError
}

import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { Client, createClient, normalizeTemporalAddress, __TEST__ as clientTest } from '../src/core-bridge/client.ts'
import { createRuntime, type RuntimeLogRecord, __TEST__ as runtimeTest } from '../src/core-bridge/runtime.ts'
import { native, type NativeLogRecord } from '../src/internal/core-bridge/native.ts'

const hasLiveServer = process.env.TEMPORAL_TEST_SERVER === '1'

describe('core bridge runtime wrapper', () => {
  test('shutdown is idempotent and prevents reuse', async () => {
    const runtime = createRuntime()
    await runtime.shutdown()
    await runtime.shutdown()
    expect(() => runtime.nativeHandle).toThrowError('Runtime has already been shut down')
  })

  test('installLogger normalizes native records and returns teardown', () => {
    const runtimeHandle = { type: 'runtime', handle: 101 } as ReturnType<typeof native.createRuntime>
    const teardownNative = mock(() => {})
    let captured: ((record: NativeLogRecord) => void) | undefined

    const originalCreateRuntime = native.createRuntime
    const originalInstallLogger = native.installLogger
    const originalRuntimeShutdown = native.runtimeShutdown

    native.createRuntime = mock(() => runtimeHandle)
    native.installLogger = mock((handle: typeof runtimeHandle, handler: (record: NativeLogRecord) => void) => {
      expect(handle).toBe(runtimeHandle)
      captured = handler
      return teardownNative
    }) as typeof native.installLogger
    native.runtimeShutdown = mock((_runtime: typeof runtimeHandle) => {}) as typeof native.runtimeShutdown

    try {
      const runtime = createRuntime()
      const handler = mock<(record: RuntimeLogRecord) => void>(() => {})
      const teardown = runtime.installLogger(handler)

      expect(typeof teardown).toBe('function')
      expect(native.installLogger).toHaveBeenCalledTimes(1)
      expect(captured).toBeDefined()

      const nativeRecord: NativeLogRecord = {
        level: 3,
        levelName: 'warn',
        timestampMs: 1_234,
        target: 'temporal_sdk_core::worker',
        message: 'core warning',
        fields: { foo: 'bar' },
        spanContexts: ['outer', 'inner'],
      }

      captured!(nativeRecord)
      expect(handler).toHaveBeenCalledTimes(1)
      const [runtimeRecord] = handler.mock.calls[0] as [RuntimeLogRecord]
      expect(runtimeRecord.level).toBe(3)
      expect(runtimeRecord.levelName).toBe('warn')
      expect(runtimeRecord.timestampMs).toBe(1_234)
      expect(runtimeRecord.timestamp).toBeInstanceOf(Date)
      expect(runtimeRecord.timestamp.getTime()).toBe(1_234)
      expect(runtimeRecord.target).toBe(nativeRecord.target)
      expect(runtimeRecord.message).toBe(nativeRecord.message)
      expect(runtimeRecord.fields).toEqual(nativeRecord.fields)
      expect(runtimeRecord.fields).not.toBe(nativeRecord.fields)
      expect(Object.isFrozen(runtimeRecord.fields)).toBe(true)
      expect(runtimeRecord.spanContexts).toEqual(nativeRecord.spanContexts)
      expect(runtimeRecord.spanContexts).not.toBe(nativeRecord.spanContexts)
      expect(Object.isFrozen(runtimeRecord.spanContexts)).toBe(true)

      teardown()
      expect(teardownNative).toHaveBeenCalledTimes(1)
    } finally {
      native.createRuntime = originalCreateRuntime
      native.installLogger = originalInstallLogger
      native.runtimeShutdown = originalRuntimeShutdown
    }
  })

  test('installLogger replaces prior callbacks and tears them down', () => {
    const runtimeHandle = { type: 'runtime', handle: 202 } as ReturnType<typeof native.createRuntime>
    const firstTeardown = mock(() => {})
    const secondTeardown = mock(() => {})
    let callCount = 0

    const originalCreateRuntime = native.createRuntime
    const originalInstallLogger = native.installLogger
    const originalRuntimeShutdown = native.runtimeShutdown

    native.createRuntime = mock(() => runtimeHandle)
    native.installLogger = mock(() => {
      callCount += 1
      return callCount === 1 ? firstTeardown : secondTeardown
    }) as typeof native.installLogger
    native.runtimeShutdown = mock((_runtime: typeof runtimeHandle) => {}) as typeof native.runtimeShutdown

    try {
      const runtime = createRuntime()
      runtime.installLogger(() => {})
      expect(callCount).toBe(1)
      expect(firstTeardown).not.toHaveBeenCalled()

      const teardownSecond = runtime.installLogger(() => {})
      expect(callCount).toBe(2)
      expect(firstTeardown).toHaveBeenCalledTimes(1)

      teardownSecond()
      expect(secondTeardown).toHaveBeenCalledTimes(1)
    } finally {
      native.createRuntime = originalCreateRuntime
      native.installLogger = originalInstallLogger
      native.runtimeShutdown = originalRuntimeShutdown
    }
  })

  test('shutdown clears active logger before releasing native runtime', async () => {
    const runtimeHandle = { type: 'runtime', handle: 303 } as ReturnType<typeof native.createRuntime>
    const order: string[] = []

    const originalCreateRuntime = native.createRuntime
    const originalInstallLogger = native.installLogger
    const originalRuntimeShutdown = native.runtimeShutdown

    native.createRuntime = mock(() => runtimeHandle)
    native.installLogger = mock(() => {
      return () => {
        order.push('logger-teardown')
      }
    }) as typeof native.installLogger
    native.runtimeShutdown = mock((_runtime: typeof runtimeHandle) => {
      order.push('runtime-shutdown')
    }) as typeof native.runtimeShutdown

    try {
      const runtime = createRuntime()
      runtime.installLogger(() => {})
      await runtime.shutdown()
      expect(order).toEqual(['logger-teardown', 'runtime-shutdown'])
    } finally {
      native.createRuntime = originalCreateRuntime
      native.installLogger = originalInstallLogger
      native.runtimeShutdown = originalRuntimeShutdown
    }
  })
})

const integrationSuite = hasLiveServer ? describe : describe.skip

describe('core bridge client wrapper', () => {
  test('normalizes addresses with protocol inference', () => {
    expect(normalizeTemporalAddress('127.0.0.1:7233')).toBe('http://127.0.0.1:7233')
    expect(normalizeTemporalAddress('127.0.0.1:7233', true)).toBe('https://127.0.0.1:7233')
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

  test('describeNamespace proxies native calls and shutdown', async () => {
    const originalCreateRuntime = native.createRuntime
    const originalRuntimeShutdown = native.runtimeShutdown
    const originalCreateClient = native.createClient
    const originalDescribe = native.describeNamespace
    const originalClientShutdown = native.clientShutdown

    const runtimeHandle = { type: 'runtime', handle: 101 } as ReturnType<typeof native.createRuntime>
    const clientHandle = { type: 'client', handle: 202 } as Awaited<ReturnType<typeof native.createClient>>

    const runtimeShutdownMock = mock(() => {})
    const clientShutdownMock = mock(() => {})
    const describeMock = mock(async () => new Uint8Array([42]))

    native.createRuntime = mock(() => runtimeHandle)
    native.runtimeShutdown = runtimeShutdownMock
    const createClientMock = mock(async (_runtime: typeof runtimeHandle, payload: Record<string, unknown>) => {
      expect(payload.address).toBe('http://127.0.0.1:7233')
      expect(payload.namespace).toBe('default')
      expect(payload.api_key).toBeUndefined()
      expect(payload.tls).toBeUndefined()
      return clientHandle
    })
    native.createClient = createClientMock as typeof native.createClient
    native.describeNamespace = describeMock
    native.clientShutdown = clientShutdownMock

    try {
      const runtime = createRuntime()
      const client = await createClient(runtime, {
        address: '127.0.0.1:7233',
        namespace: 'default',
      })

      const result = await client.describeNamespace('custom')
      expect(Array.from(result)).toEqual([42])

      await client.shutdown()
      await runtime.shutdown()

      expect(describeMock).toHaveBeenCalledWith(clientHandle, 'custom')
      expect(clientShutdownMock).toHaveBeenCalledTimes(1)
      expect(runtimeShutdownMock).toHaveBeenCalledTimes(1)
    } finally {
      native.createRuntime = originalCreateRuntime
      native.runtimeShutdown = originalRuntimeShutdown
      native.createClient = originalCreateClient
      native.describeNamespace = originalDescribe
      native.clientShutdown = originalClientShutdown
    }
  })

  test('runtime finalizer swallows native shutdown errors', () => {
    const originalRuntimeShutdown = native.runtimeShutdown
    native.runtimeShutdown = mock(() => {
      throw new Error('finalizer-failure')
    })

    expect(() => runtimeTest.finalizeRuntime({ type: 'runtime', handle: 99 } as any)).not.toThrow()

    native.runtimeShutdown = originalRuntimeShutdown
  })

  test('client finalizer swallows native shutdown errors', () => {
    const originalClientShutdown = native.clientShutdown
    native.clientShutdown = mock(() => {
      throw new Error('finalizer-failure')
    })

    expect(() => clientTest.finalizeClient({ type: 'client', handle: 77 } as any)).not.toThrow()

    native.clientShutdown = originalClientShutdown
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

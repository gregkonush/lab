import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test'
import { Client, createClient, normalizeTemporalAddress, __TEST__ as clientTest } from '../src/core-bridge/client.ts'
import { createRuntime, __TEST__ as runtimeTest } from '../src/core-bridge/runtime.ts'
import { native } from '../src/internal/core-bridge/native.ts'

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

  test('serializeTlsOptions emits camelCase payload and keeps legacy aliases', () => {
    const payload = clientTest.serializeTlsOptions({
      serverRootCACertificate: 'ca-base64',
      clientCert: 'cert-base64',
      clientPrivateKey: 'key-base64',
      serverNameOverride: 'tls.example',
    })

    expect(payload).toEqual(
      expect.objectContaining({
        serverRootCACertificate: 'ca-base64',
        server_root_ca_cert: 'ca-base64',
        serverNameOverride: 'tls.example',
        server_name_override: 'tls.example',
        clientCertPair: {
          crt: 'cert-base64',
          key: 'key-base64',
        },
        client_cert: 'cert-base64',
        client_private_key: 'key-base64',
      }),
    )
  })

  test('serializeTlsOptions handles partial TLS inputs', () => {
    expect(
      clientTest.serializeTlsOptions({
        serverRootCACertificate: 'ca-only',
        serverNameOverride: 'tls.example',
        clientCert: 'cert-only',
      }),
    ).toEqual({
      serverRootCACertificate: 'ca-only',
      server_root_ca_cert: 'ca-only',
      serverNameOverride: 'tls.example',
      server_name_override: 'tls.example',
      clientCert: 'cert-only',
      client_cert: 'cert-only',
    })

    expect(
      clientTest.serializeTlsOptions({
        serverNameOverride: 'tls.example',
        clientPrivateKey: 'key-only',
      }),
    ).toEqual({
      serverNameOverride: 'tls.example',
      server_name_override: 'tls.example',
      clientPrivateKey: 'key-only',
      client_private_key: 'key-only',
    })
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

  test('emits camel-cased allowInsecure flag', async () => {
    const originalCreateRuntime = native.createRuntime
    const originalRuntimeShutdown = native.runtimeShutdown
    const originalCreateClient = native.createClient
    const originalClientShutdown = native.clientShutdown

    const runtimeHandle = { type: 'runtime', handle: 404 } as ReturnType<typeof native.createRuntime>
    const clientHandle = { type: 'client', handle: 505 } as Awaited<ReturnType<typeof native.createClient>>

    native.createRuntime = mock(() => runtimeHandle)
    native.runtimeShutdown = mock(() => {})
    native.clientShutdown = mock(() => {})
    const createClientMock = mock(async (_runtime: typeof runtimeHandle, payload: Record<string, unknown>) => {
      expect(payload.allowInsecure).toBe(true)
      expect('allow_insecure' in payload).toBe(false)
      return clientHandle
    })
    native.createClient = createClientMock as typeof native.createClient

    try {
      const runtime = createRuntime()
      const client = await createClient(runtime, {
        address: '127.0.0.1:7233',
        namespace: 'default',
        allowInsecure: true,
      })

      await client.shutdown()
      await runtime.shutdown()

      expect(createClientMock).toHaveBeenCalledTimes(1)
    } finally {
      native.createRuntime = originalCreateRuntime
      native.runtimeShutdown = originalRuntimeShutdown
      native.createClient = originalCreateClient
      native.clientShutdown = originalClientShutdown
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

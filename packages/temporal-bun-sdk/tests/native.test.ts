import { describe, expect, test } from 'bun:test'
import { native } from '../src/internal/core-bridge/native.ts'

const hasLiveTemporalServer = process.env.TEMPORAL_TEST_SERVER === '1'

describe('native bridge', () => {
  test('create and shutdown runtime', () => {
    const runtime = native.createRuntime({})
    expect(runtime.type).toBe('runtime')
    expect(typeof runtime.handle).toBe('number')
    native.runtimeShutdown(runtime)
  })

  test('client connect respects server availability', () => {
    const runtime = native.createRuntime({})
    try {
      const connect = () =>
        native.createClient(runtime, {
          address: 'http://127.0.0.1:7233',
          namespace: 'default',
        })

      if (hasLiveTemporalServer) {
        const client = connect()
        expect(client.type).toBe('client')
        expect(typeof client.handle).toBe('number')
        native.clientShutdown(client)
      } else {
        expect(connect).toThrow()
      }
    } finally {
      native.runtimeShutdown(runtime)
    }
  })

  test('client connect errors on unreachable host', () => {
    const runtime = native.createRuntime({})
    try {
      expect(() =>
        native.createClient(runtime, {
          address: 'http://127.0.0.1:65535',
          namespace: 'default',
        }),
      ).toThrow()
    } finally {
      native.runtimeShutdown(runtime)
    }
  })
})

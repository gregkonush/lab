import { describe, expect, test } from 'bun:test'
import { native } from '../src/internal/core-bridge/native.ts'

describe('native bridge', () => {
  test('create and shutdown runtime', () => {
    const runtime = native.createRuntime({})
    expect(runtime.type).toBe('runtime')
    expect(typeof runtime.handle).toBe('number')
    native.runtimeShutdown(runtime)
  })

  test('client connect returns handle', () => {
    const runtime = native.createRuntime({})
    try {
      const client = native.createClient(runtime, {
        address: 'http://127.0.0.1:7233',
        namespace: 'default',
      })
      expect(client.type).toBe('client')
      expect(typeof client.handle).toBe('number')
      native.clientShutdown(client)
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

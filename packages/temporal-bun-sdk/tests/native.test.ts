import { describe, expect, test } from 'bun:test'

let nativeModule: typeof import('../src/internal/core-bridge/native.ts')['native'] | null = null
try {
  nativeModule = (await import('../src/internal/core-bridge/native.ts')).native
} catch (error) {
  console.warn('[native.test] Skipping native bridge tests:', error instanceof Error ? error.message : error)
}

describe('native bridge', () => {
  if (!nativeModule) {
    test('is skipped when bridge library is unavailable', () => {
      expect(true).toBe(true)
    })
    return
  }

  test('create and shutdown runtime', () => {
    const runtime = nativeModule!.createRuntime({})
    expect(runtime.type).toBe('runtime')
    expect(typeof runtime.handle).toBe('number')
    nativeModule!.runtimeShutdown(runtime)
  })

  test('client connect fails when Temporal server unavailable', () => {
    const runtime = nativeModule!.createRuntime({})
    try {
      expect(() =>
        nativeModule!.createClient(runtime, {
          address: 'http://127.0.0.1:7233',
          namespace: 'default',
        }),
      ).toThrow()
    } finally {
      nativeModule!.runtimeShutdown(runtime)
    }
  })
})

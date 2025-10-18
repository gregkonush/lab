import { describe, expect, mock, spyOn, test } from 'bun:test'
import type { TemporalConfig } from '../src/config.ts'
import * as configModule from '../src/config.ts'
import * as runtimeModule from '../src/core-bridge/runtime.ts'
import * as clientModule from '../src/core-bridge/client.ts'
import { handleCheck } from '../src/bin/temporal-bun.ts'

const baseConfig: TemporalConfig = {
  host: '127.0.0.1',
  port: 7233,
  address: '127.0.0.1:7233',
  namespace: 'default',
  taskQueue: 'prix',
  apiKey: undefined,
  tls: undefined,
  allowInsecureTls: false,
  workerIdentity: 'test-worker-123',
  workerIdentityPrefix: 'test-worker',
}

const originalConsoleLog = console.log
const originalConsoleError = console.error

describe('temporal-bun check command', () => {
  test('logs success when Temporal namespace is reachable', async () => {
    const runtimeShutdown = mock(async () => {})
    const describeNamespace = mock(async () => new Uint8Array([1, 2, 3]))
    const clientShutdown = mock(async () => {})
    const logSpy = mock(() => {})

    const loadConfigSpy = spyOn(configModule, 'loadTemporalConfig').mockResolvedValue(baseConfig)
    const createRuntimeSpy = spyOn(runtimeModule, 'createRuntime').mockReturnValue({
      shutdown: runtimeShutdown,
    } as unknown as ReturnType<typeof runtimeModule.createRuntime>)
    const createClientSpy = spyOn(clientModule, 'createClient').mockResolvedValue({
      describeNamespace,
      shutdown: clientShutdown,
    } as unknown as Awaited<ReturnType<typeof clientModule.createClient>>)

    console.log = logSpy

    try {
      await handleCheck([], {})

      expect(describeNamespace).toHaveBeenCalledWith('default')
      expect(clientShutdown).toHaveBeenCalledTimes(1)
      expect(runtimeShutdown).toHaveBeenCalledTimes(1)
      expect(logSpy.mock.calls[0][0]).toContain('Connected to Temporal namespace "default"')
    } finally {
      console.log = originalConsoleLog
      loadConfigSpy.mockRestore()
      createRuntimeSpy.mockRestore()
      createClientSpy.mockRestore()
    }
  })

  test('throws contextual error when connection fails', async () => {
    const runtimeShutdown = mock(async () => {})

    const loadConfigSpy = spyOn(configModule, 'loadTemporalConfig').mockResolvedValue(baseConfig)
    const createRuntimeSpy = spyOn(runtimeModule, 'createRuntime').mockReturnValue({
      shutdown: runtimeShutdown,
    } as unknown as ReturnType<typeof runtimeModule.createRuntime>)
    const createClientSpy = spyOn(clientModule, 'createClient').mockRejectedValue(new Error('boom'))

    console.error = mock(() => {})

    try {
      await expect(handleCheck([], {})).rejects.toThrow('Failed to reach Temporal at 127.0.0.1:7233: boom')
      expect(runtimeShutdown).toHaveBeenCalledTimes(1)
    } finally {
      console.error = originalConsoleError
      loadConfigSpy.mockRestore()
      createRuntimeSpy.mockRestore()
      createClientSpy.mockRestore()
    }
  })
})

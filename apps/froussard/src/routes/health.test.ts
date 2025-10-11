import { describe, expect, it, vi } from 'vitest'

import { createHealthHandlers } from '@/routes/health'

const createRuntime = () => ({
  runSync: vi.fn(),
})

describe('createHealthHandlers', () => {
  const kafkaEffect = Symbol('kafka-Ready') as never

  it('returns OK for liveness', () => {
    const runtime = createRuntime()
    const handlers = createHealthHandlers({ runtime, kafka: { isReady: kafkaEffect } as never })
    const response = handlers.liveness()

    expect(response.status).toBe(200)
  })

  it('returns 503 when kafka is not ready', () => {
    const runtime = createRuntime()
    runtime.runSync.mockReturnValue(false)
    const handlers = createHealthHandlers({ runtime, kafka: { isReady: kafkaEffect } as never })
    const response = handlers.readiness()

    expect(response.status).toBe(503)
    expect(runtime.runSync).toHaveBeenCalledWith(kafkaEffect)
  })

  it('returns OK when kafka is ready', () => {
    const runtime = createRuntime()
    runtime.runSync.mockReturnValue(true)
    const handlers = createHealthHandlers({ runtime, kafka: { isReady: kafkaEffect } as never })
    const response = handlers.readiness()

    expect(response.status).toBe(200)
    expect(runtime.runSync).toHaveBeenCalledWith(kafkaEffect)
  })
})

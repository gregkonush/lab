import { describe, expect, it, vi } from 'vitest'

import { createHealthHandlers } from '@/routes/health'

describe('createHealthHandlers', () => {
  const kafka = {
    isReady: vi.fn(),
  }

  it('returns OK for liveness', () => {
    const handlers = createHealthHandlers(kafka as never)
    const response = handlers.liveness()

    expect(response.status).toBe(200)
  })

  it('returns 503 when kafka is not ready', () => {
    kafka.isReady.mockReturnValue(false)
    const handlers = createHealthHandlers(kafka as never)
    const response = handlers.readiness()

    expect(response.status).toBe(503)
  })

  it('returns OK when kafka is ready', () => {
    kafka.isReady.mockReturnValue(true)
    const handlers = createHealthHandlers(kafka as never)
    const response = handlers.readiness()

    expect(response.status).toBe(200)
  })
})

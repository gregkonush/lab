import { describe, expect, test } from 'bun:test'

import { initializeErrorTracking, sanitizeErrorEvent } from './error-tracking'

describe('GlitchTip error-only safety boundary', () => {
  test('disabled if DSN is missing', () => {
    expect(initializeErrorTracking('bayn', {})).toBe(false)
  })

  test('rejects dashed UUID keys instead of silently dropping events', () => {
    expect(() =>
      initializeErrorTracking('bayn', {
        BAYN_GLITCHTIP_DSN: 'http://591bd90b-e7b8-4b22-856e-c7c1bd456ec2@glitchtip-web.glitchtip.svc.cluster.local/1',
      }),
    ).toThrow('invalid project key')
  })

  test('redacts potentially sensitive exception data but retains frames', () => {
    const event = sanitizeErrorEvent({
      type: undefined,
      message: 'broker account=secret',
      user: { id: 'customer-id' },
      request: { url: 'https://secret.example/?token=private' },
      breadcrumbs: [{ message: 'broker credentials here' }],
      extra: { account: 'private' },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'broker key is private',
            stacktrace: {
              frames: [
                {
                  filename: 'strategy.ts',
                  lineno: 31,
                  function: 'evaluate',
                  vars: { key: 'secret' },
                  context_line: 'key=secret',
                },
              ],
            },
          },
        ],
      },
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('customer-id')
    expect(event.message).toBe('Bayn application exception')
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.function).toBe('evaluate')
  })
})

import { describe, expect, it, vi } from 'vitest'

import type { AppConfig } from './config'
import { createMessageProcessor, IdempotencyCache } from './runner'
import fixture from '../fixtures/argo-completion.json' with { type: 'json' }

const baseConfig: AppConfig = {
  kafka: {
    brokers: ['broker:9092'],
    clientId: 'courriel',
    groupId: 'courriel-group',
    topic: 'argo.workflows.completions',
    sasl: {
      mechanism: 'scram-sha-512',
      username: 'user',
      password: 'pass',
    },
    ssl: true,
  },
  resend: {
    apiKey: 're_test',
    from: 'Courriel <courriel@example.com>',
    fallbackRecipients: ['fallback@example.com'],
  },
  email: {
    subjectPrefix: '[Argo]',
  },
  logging: {
    level: 'info',
  },
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as const

describe('createMessageProcessor', () => {
  it('suppresses duplicate messages based on UID', async () => {
    const resend = {
      emails: {
        send: vi.fn().mockResolvedValue({ id: 'email-1' }),
      },
    }

    const processor = createMessageProcessor({
      config: baseConfig,
      resend: resend as any,
      logger: logger as any,
      idempotencyCache: new IdempotencyCache(10),
    })

    const payload = {
      topic: baseConfig.kafka.topic,
      partition: 0,
      message: {
        key: Buffer.from('dedupe-key'),
        value: Buffer.from(JSON.stringify(fixture)),
        offset: '0',
        timestamp: Date.now().toString(),
        headers: {},
      },
      heartbeat: vi.fn(),
      pause: vi.fn(),
      commitOffsetsIfNecessary: vi.fn(),
      uncommittedOffsets: vi.fn(),
      isRunning: () => true,
      isStale: () => false,
    }

    await processor(payload as any)
    await processor(payload as any)

    expect(resend.emails.send).toHaveBeenCalledTimes(1)
  })

  it('does not call Resend when payload lacks recipients', async () => {
    const resend = {
      emails: {
        send: vi.fn().mockResolvedValue({ id: 'email-1' }),
      },
    }

    const processor = createMessageProcessor({
      config: {
        ...baseConfig,
        resend: {
          ...baseConfig.resend,
          fallbackRecipients: [],
        },
      },
      resend: resend as any,
      logger: logger as any,
      idempotencyCache: new IdempotencyCache(10),
    })

    const payload = {
      topic: baseConfig.kafka.topic,
      partition: 0,
      message: {
        key: Buffer.from('no-recipient'),
        value: Buffer.from(
          JSON.stringify({
            metadata: {
              name: 'no-recipients',
              namespace: 'argo',
              uid: 'uid-1',
              annotations: {},
              labels: {},
            },
            status: {
              phase: 'Succeeded',
            },
          }),
        ),
        offset: '0',
        timestamp: Date.now().toString(),
        headers: {},
      },
      heartbeat: vi.fn(),
      pause: vi.fn(),
      commitOffsetsIfNecessary: vi.fn(),
      uncommittedOffsets: vi.fn(),
      isRunning: () => true,
      isStale: () => false,
    }

    await processor(payload as any)

    expect(resend.emails.send).not.toHaveBeenCalled()
  })
})

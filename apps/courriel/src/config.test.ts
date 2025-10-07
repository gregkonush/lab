import { describe, expect, it } from 'vitest'

import { configSchema, parseConfig } from './config'

const baseEnv = {
  KAFKA_BROKERS: 'broker-1:9092,broker-2:9092',
  KAFKA_CLIENT_ID: 'courriel-test',
  KAFKA_GROUP_ID: 'courriel-group',
  KAFKA_TOPIC: 'argo.workflows.completions',
  KAFKA_USERNAME: 'test-user',
  KAFKA_PASSWORD: 'test-pass',
  RESEND_API_KEY: 're_abcd',
  RESEND_FROM: 'Courriel <courriel@example.com>',
  RESEND_TO: 'fallback@example.com, secondary@example.com',
  COURIEL_SUBJECT_PREFIX: '[Argo]',
  COURIEL_LOG_LEVEL: 'debug',
} satisfies NodeJS.ProcessEnv

describe('config', () => {
  it('parses valid environment variables', () => {
    const result = parseConfig(baseEnv)

    expect(result.kafka).toEqual({
      brokers: ['broker-1:9092', 'broker-2:9092'],
      clientId: 'courriel-test',
      groupId: 'courriel-group',
      topic: 'argo.workflows.completions',
      sasl: {
        mechanism: 'scram-sha-512',
        username: 'test-user',
        password: 'test-pass',
      },
      ssl: true,
    })

    expect(result.resend).toEqual({
      apiKey: 're_abcd',
      from: 'Courriel <courriel@example.com>',
      fallbackRecipients: ['fallback@example.com', 'secondary@example.com'],
    })

    expect(result.email.subjectPrefix).toBe('[Argo]')
    expect(result.logging.level).toBe('debug')
  })

  it('fails when required entries are missing', () => {
    const parsed = configSchema.safeParse({})
    expect(parsed.success).toBe(false)

    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toContain('KAFKA_BROKERS')
    }
  })

  it('defaults optional entries when absent', () => {
    const env = {
      ...baseEnv,
      RESEND_TO: undefined,
      COURIEL_SUBJECT_PREFIX: undefined,
      COURIEL_LOG_LEVEL: undefined,
    }

    const result = parseConfig(env)

    expect(result.resend.fallbackRecipients).toEqual([])
    expect(result.email.subjectPrefix).toBeNull()
    expect(result.logging.level).toBe('info')
  })
})

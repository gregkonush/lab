import { describe, expect, it } from 'vitest'

import { loadConfig } from '@/config'

const baseEnv = {
  GITHUB_WEBHOOK_SECRET: 'secret',
  KAFKA_BROKERS: 'broker1:9092,broker2:9093',
  KAFKA_USERNAME: 'user',
  KAFKA_PASSWORD: 'pass',
  KAFKA_TOPIC: 'raw-topic',
  KAFKA_CODEX_TOPIC: 'codex-topic',
}

describe('loadConfig', () => {
  it('parses brokers and returns defaults', () => {
    const config = loadConfig(baseEnv)

    expect(config.kafka.brokers).toEqual(['broker1:9092', 'broker2:9093'])
    expect(config.codebase.baseBranch).toBe('main')
    expect(config.codebase.branchPrefix).toBe('codex/issue-')
    expect(config.codex.triggerLogin).toBe('gregkonush')
    expect(config.codex.implementationTriggerPhrase).toBe('execute plan')
  })

  it('allows overriding defaults via env', () => {
    const env = {
      ...baseEnv,
      CODEX_BASE_BRANCH: 'develop',
      CODEX_BRANCH_PREFIX: 'custom/',
      CODEX_TRIGGER_LOGIN: 'TESTUSER',
      CODEX_IMPLEMENTATION_TRIGGER: 'run it',
      GITHUB_ACK_REACTION: 'eyes',
    }

    const config = loadConfig(env)
    expect(config.codebase.baseBranch).toBe('develop')
    expect(config.codebase.branchPrefix).toBe('custom/')
    expect(config.codex.triggerLogin).toBe('testuser')
    expect(config.codex.implementationTriggerPhrase).toBe('run it')
    expect(config.github.ackReaction).toBe('eyes')
  })

  it('throws when required env is missing', () => {
    expect(() => loadConfig({ ...baseEnv, KAFKA_BROKERS: '' })).toThrow()
    expect(() => loadConfig({ ...baseEnv, GITHUB_WEBHOOK_SECRET: undefined })).toThrow()
  })
})

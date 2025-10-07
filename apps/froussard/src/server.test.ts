import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockApp = {
  get: vi.fn(() => mockApp),
  on: vi.fn(() => mockApp),
  onError: vi.fn(() => mockApp),
  post: vi.fn(() => mockApp),
  listen: vi.fn(() => ({ server: { hostname: '127.0.0.1', port: 8080 } })),
}

const mockKafkaManager = {
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
}

vi.mock('@/config', () => ({
  loadConfig: vi.fn(() => ({
    githubWebhookSecret: 'secret',
    kafka: {
      brokers: ['broker:9092'],
      username: 'user',
      password: 'pass',
      clientId: 'client',
      topics: { raw: 'raw', codex: 'codex' },
    },
    codebase: {
      baseBranch: 'main',
      branchPrefix: 'codex/issue-',
    },
    codex: {
      triggerLogin: 'gregkonush',
      implementationTriggerPhrase: 'execute plan',
    },
    github: {
      token: 'token',
      ackReaction: '+1',
      apiBaseUrl: 'https://api.github.com',
      userAgent: 'agent',
    },
  })),
}))

vi.mock('@/services/kafka', () => ({
  KafkaManager: vi.fn(() => mockKafkaManager),
}))

vi.mock('@octokit/webhooks', () => ({
  Webhooks: vi.fn(() => ({ verify: vi.fn(async () => true) })),
}))

vi.mock('@/routes/health', () => ({
  createHealthHandlers: vi.fn(() => ({
    liveness: () => new Response('OK'),
    readiness: () => new Response('OK'),
  })),
}))

vi.mock('@/routes/webhooks', () => ({
  createWebhookHandler: vi.fn(() => vi.fn()),
}))

vi.mock('elysia', () => ({
  Elysia: vi.fn(() => mockApp),
}))

describe('server bootstrap', () => {
  const oldEnv = process.env

  beforeEach(() => {
    process.env = {
      ...oldEnv,
      NODE_ENV: 'test',
    }
  })

  afterEach(() => {
    process.env = oldEnv
    vi.resetModules()
  })

  it('bootstraps server without throwing', async () => {
    await import('@/server')
    expect(mockApp.listen).toHaveBeenCalled()
    expect(mockKafkaManager.connect).toHaveBeenCalled()
  })
})

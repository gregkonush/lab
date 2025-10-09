import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWebhookHandler, type WebhookConfig } from '@/routes/webhooks'

const { mockVerifyDiscordRequest, mockToCommandEvent } = vi.hoisted(() => ({
  mockVerifyDiscordRequest: vi.fn(async () => true),
  mockToCommandEvent: vi.fn(() => ({
    provider: 'discord' as const,
    interactionId: 'interaction-123',
    applicationId: 'app-123',
    command: 'plan',
    commandId: 'command-1',
    version: 1,
    token: 'token-123',
    options: { project: 'alpha' },
    guildId: 'guild-1',
    channelId: 'channel-1',
    user: { id: 'user-1' },
    locale: 'en-US',
    response: { type: 5, flags: 64 },
    timestamp: '2025-10-09T00:00:00.000Z',
  })),
}))

vi.mock('@/discord-commands', () => ({
  verifyDiscordRequest: mockVerifyDiscordRequest,
  toCommandEvent: mockToCommandEvent,
  INTERACTION_TYPE: { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3 },
}))

vi.mock('@/codex', () => ({
  buildCodexBranchName: vi.fn(() => 'codex/issue-1-test'),
  buildCodexPrompt: vi.fn(() => 'PROMPT'),
  normalizeLogin: vi.fn((value: string | undefined | null) => (value ? value.toLowerCase() : null)),
}))

vi.mock('@/services/github', () => ({
  postIssueReaction: vi.fn(async () => ({ ok: true })),
  findLatestPlanComment: vi.fn(async () => ({ ok: false, reason: 'not-found' })),
}))

vi.mock('@/codex-workflow', () => ({
  selectReactionRepository: vi.fn((issueRepository, repository) => issueRepository ?? repository),
}))

vi.mock('@/github-payload', () => ({
  deriveRepositoryFullName: vi.fn(() => 'owner/repo'),
  isGithubIssueEvent: vi.fn((payload: unknown) => Boolean((payload as { issue?: unknown }).issue)),
  isGithubIssueCommentEvent: vi.fn((payload: unknown) => Boolean((payload as { issue?: unknown }).issue)),
}))

const buildRequest = (body: unknown, headers: Record<string, string>) => {
  return new Request('http://localhost/webhooks/github', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const buildDiscordRequest = (body: unknown, headers: Record<string, string> = {}) => {
  return new Request('http://localhost/webhooks/discord', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('createWebhookHandler', () => {
  const kafka = {
    publish: vi.fn(async () => undefined),
  }

  const webhooks = {
    verify: vi.fn(async () => true),
  }

  const baseConfig: WebhookConfig = {
    codebase: {
      baseBranch: 'main',
      branchPrefix: 'codex/issue-',
    },
    github: {
      token: 'token',
      ackReaction: '+1',
      apiBaseUrl: 'https://api.github.com',
      userAgent: 'froussard',
    },
    codexTriggerLogin: 'user',
    codexImplementationTriggerPhrase: 'execute plan',
    topics: {
      raw: 'raw-topic',
      codex: 'codex-topic',
      discordCommands: 'discord-topic',
    },
    discord: {
      publicKey: 'public-key',
      response: {
        deferType: 'channel-message',
        ephemeral: true,
      },
    },
  }

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('rejects unsupported providers', async () => {
    const handler = createWebhookHandler({ kafka: kafka as never, webhooks: webhooks as never, config: baseConfig })
    const response = await handler(
      new Request('http://localhost/webhooks/slack', { method: 'POST', body: '' }),
      'slack',
    )
    expect(response.status).toBe(400)
    expect(webhooks.verify).not.toHaveBeenCalled()
  })

  it('returns 401 when signature header missing', async () => {
    const handler = createWebhookHandler({ kafka: kafka as never, webhooks: webhooks as never, config: baseConfig })
    const response = await handler(buildRequest({}, {}), 'github')
    expect(response.status).toBe(401)
  })

  it('publishes planning message on issue opened', async () => {
    const handler = createWebhookHandler({ kafka: kafka as never, webhooks: webhooks as never, config: baseConfig })
    const payload = {
      action: 'opened',
      issue: {
        number: 1,
        title: 'Test issue',
        body: 'Body',
        user: { login: 'USER' },
        html_url: 'https://example.com',
      },
      repository: { default_branch: 'main' },
      sender: { login: 'USER' },
    }

    const response = await handler(
      buildRequest(payload, {
        'x-github-event': 'issues',
        'x-github-delivery': 'delivery-123',
        'x-hub-signature-256': 'sig',
        'content-type': 'application/json',
      }),
      'github',
    )

    expect(response.status).toBe(202)
    expect(kafka.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'codex-topic',
        key: 'issue-1-planning',
      }),
    )
    expect(kafka.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'raw-topic',
        key: 'delivery-123',
      }),
    )
  })

  it('publishes implementation message when trigger comment is received', async () => {
    const { findLatestPlanComment } = await import('@/services/github')
    vi.mocked(findLatestPlanComment).mockResolvedValueOnce({
      ok: true,
      comment: { id: 10, body: 'Plan', htmlUrl: 'https://comment' },
    })

    const handler = createWebhookHandler({ kafka: kafka as never, webhooks: webhooks as never, config: baseConfig })
    const payload = {
      action: 'created',
      issue: {
        number: 2,
        title: 'Implementation issue',
        body: 'Body',
        html_url: 'https://issue',
      },
      repository: { default_branch: 'main' },
      sender: { login: 'USER' },
      comment: { body: 'execute plan' },
    }

    await handler(
      buildRequest(payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'delivery-999',
        'x-hub-signature-256': 'sig',
        'content-type': 'application/json',
      }),
      'github',
    )

    expect(findLatestPlanComment).toHaveBeenCalled()
    expect(kafka.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'codex-topic',
        key: 'issue-2-implementation',
      }),
    )
    expect(kafka.publish).toHaveBeenCalledWith(expect.objectContaining({ topic: 'raw-topic', key: 'delivery-999' }))
  })

  it('returns 401 when Discord signature verification fails', async () => {
    mockVerifyDiscordRequest.mockResolvedValueOnce(false)
    const handler = createWebhookHandler({ kafka: kafka as never, webhooks: webhooks as never, config: baseConfig })

    const response = await handler(
      buildDiscordRequest(
        {
          type: 2,
        },
        {
          'x-signature-ed25519': 'sig',
          'x-signature-timestamp': 'timestamp',
        },
      ),
      'discord',
    )

    expect(response.status).toBe(401)
    expect(kafka.publish).not.toHaveBeenCalled()
  })

  it('publishes Discord command events and returns deferred ack', async () => {
    const handler = createWebhookHandler({ kafka: kafka as never, webhooks: webhooks as never, config: baseConfig })

    const response = await handler(
      buildDiscordRequest(
        {
          type: 2,
          id: 'interaction-123',
          token: 'token',
        },
        {
          'x-signature-ed25519': 'sig',
          'x-signature-timestamp': 'timestamp',
        },
      ),
      'discord',
    )

    expect(mockVerifyDiscordRequest).toHaveBeenCalled()
    expect(mockToCommandEvent).toHaveBeenCalled()
    expect(kafka.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: 'discord-topic',
        key: 'interaction-123',
      }),
    )

    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toEqual({
      type: 4,
      data: {
        content: 'Command `/plan` received. Workflow hand-off in progress…',
        flags: 64,
      },
    })
  })

  it('responds to Discord ping interactions', async () => {
    const handler = createWebhookHandler({ kafka: kafka as never, webhooks: webhooks as never, config: baseConfig })

    const response = await handler(
      buildDiscordRequest(
        {
          type: 1,
        },
        {
          'x-signature-ed25519': 'sig',
          'x-signature-timestamp': 'timestamp',
        },
      ),
      'discord',
    )

    expect(mockToCommandEvent).not.toHaveBeenCalled()
    expect(kafka.publish).not.toHaveBeenCalled()
    const payload = await response.json()
    expect(payload).toEqual({ type: 1 })
  })
})

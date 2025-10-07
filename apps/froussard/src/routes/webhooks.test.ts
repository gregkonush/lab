import { afterEach, describe, expect, it, vi } from 'vitest'

import { createWebhookHandler, type WebhookConfig } from '@/routes/webhooks'

vi.mock('@/codex', () => ({
  buildCodexBranchName: vi.fn(() => 'codex/issue-1-test'),
  buildCodexOneShotPrompts: vi.fn(() => ({
    planningPrompt: 'PLANNING_PROMPT',
    implementationPrompt: 'IMPLEMENTATION_PROMPT',
    planPlaceholder: '{{PLAN}}',
  })),
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
    codexOneShotTriggerPhrase: 'execute one-shot',
    topics: {
      raw: 'raw-topic',
      codex: 'codex-topic',
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

  it('publishes one-shot message when the one-shot trigger comment is received', async () => {
    const { findLatestPlanComment } = await import('@/services/github')
    const { buildCodexOneShotPrompts } = await import('@/codex')

    const handler = createWebhookHandler({ kafka: kafka as never, webhooks: webhooks as never, config: baseConfig })
    const payload = {
      action: 'created',
      issue: {
        number: 3,
        title: 'Combined workflow issue',
        body: 'Body',
        html_url: 'https://issue',
      },
      repository: { default_branch: 'main' },
      sender: { login: 'USER' },
      comment: { body: 'execute one-shot' },
    }

    const response = await handler(
      buildRequest(payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'delivery-1000',
        'x-hub-signature-256': 'sig',
        'content-type': 'application/json',
      }),
      'github',
    )

    expect(response.status).toBe(202)
    expect(buildCodexOneShotPrompts).toHaveBeenCalledWith(
      expect.objectContaining({
        issueNumber: 3,
        headBranch: 'codex/issue-1-test',
      }),
    )
    expect(findLatestPlanComment).not.toHaveBeenCalled()

    const publishCalls = vi.mocked(kafka.publish).mock.calls as unknown as Array<[Record<string, unknown>]>
    const codexCall = publishCalls.find(([message]) => (message.topic as string | undefined) === 'codex-topic')
    expect(codexCall).toBeDefined()
    if (!codexCall) {
      throw new Error('codex-topic message not published')
    }
    const [codexMessage] = codexCall
    const typedCodexMessage = codexMessage as { value: string; headers: Record<string, string>; key: string }
    expect(typedCodexMessage.key).toBe('issue-3-one-shot')
    expect(typedCodexMessage.headers['x-codex-task-stage']).toBe('one-shot')
    const parsed = JSON.parse(typedCodexMessage.value ?? '{}')
    expect(parsed.stage).toBe('one-shot')
    expect(parsed.planningPrompt).toBe('PLANNING_PROMPT')
    expect(parsed.implementationPrompt).toBe('IMPLEMENTATION_PROMPT')
    expect(parsed.planPlaceholder).toBe('{{PLAN}}')

    expect(kafka.publish).toHaveBeenCalledWith(expect.objectContaining({ topic: 'raw-topic', key: 'delivery-1000' }))
  })
})

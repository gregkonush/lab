import { Effect, Layer } from 'effect'
import { type ManagedRuntime, make as makeManagedRuntime } from 'effect/ManagedRuntime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppLogger } from '@/logger'
import { CommandEvent as FacteurCommandEventMessage } from '@/proto/facteur/v1/contract_pb'
import { CodexTask, CodexTaskStage } from '@/proto/github/v1/codex_task_pb'
import { createWebhookHandler, type WebhookConfig } from '@/routes/webhooks'
import { GithubService } from '@/services/github'
import { type KafkaMessage, KafkaProducer } from '@/services/kafka'

const { mockVerifyDiscordRequest, mockBuildPlanModalResponse, mockToPlanModalEvent } = vi.hoisted(() => ({
  mockVerifyDiscordRequest: vi.fn(async () => true),
  mockBuildPlanModalResponse: vi.fn(() => ({
    type: 9,
    data: {
      custom_id: 'plan:cmd-1',
      title: 'Request Planning Run',
      components: [],
    },
  })),
  mockToPlanModalEvent: vi.fn(() => ({
    provider: 'discord' as const,
    interactionId: 'interaction-123',
    applicationId: 'app-123',
    command: 'plan',
    commandId: 'command-1',
    version: 1,
    token: 'token-123',
    options: { content: 'Ship the release with QA gating' },
    guildId: 'guild-1',
    channelId: 'channel-1',
    user: { id: 'user-1', username: 'tester', globalName: 'Tester', discriminator: '1234' },
    member: undefined,
    locale: 'en-US',
    guildLocale: 'en-US',
    response: { type: 4, flags: 64 },
    timestamp: '2025-10-09T00:00:00.000Z',
    correlationId: '',
    traceId: '',
  })),
}))

vi.mock('@/discord-commands', () => ({
  verifyDiscordRequest: mockVerifyDiscordRequest,
  buildPlanModalResponse: mockBuildPlanModalResponse,
  toPlanModalEvent: mockToPlanModalEvent,
  INTERACTION_TYPE: { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, MODAL_SUBMIT: 5 },
}))

vi.mock('@/codex', () => ({
  buildCodexBranchName: vi.fn(() => 'codex/issue-1-test'),
  buildCodexPrompt: vi.fn(() => 'PROMPT'),
  normalizeLogin: vi.fn((value: string | undefined | null) => (value ? value.toLowerCase() : null)),
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

const toBuffer = (value: KafkaMessage['value']): Buffer => {
  if (Buffer.isBuffer(value)) {
    return value
  }
  if (typeof value === 'string') {
    return Buffer.from(value)
  }
  return Buffer.from(value)
}

describe('createWebhookHandler', () => {
  let runtime: ManagedRuntime<unknown, never>
  let publishedMessages: KafkaMessage[]
  let githubServiceMock: {
    postIssueReaction: ReturnType<typeof vi.fn>
    findLatestPlanComment: ReturnType<typeof vi.fn>
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
    codexWorkflowLogin: 'github-actions[bot]',
    codexImplementationTriggerPhrase: 'execute plan',
    topics: {
      raw: 'raw-topic',
      codex: 'codex-topic',
      codexStructured: 'github.issues.codex.tasks',
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

  const provideRuntime = () => {
    const kafkaLayer = Layer.succeed(KafkaProducer, {
      publish: (message: KafkaMessage) =>
        Effect.sync(() => {
          publishedMessages.push(message)
        }),
      ensureConnected: Effect.succeed(undefined),
      isReady: Effect.succeed(true),
    })

    const loggerLayer = Layer.succeed(AppLogger, {
      debug: () => Effect.succeed(undefined),
      info: () => Effect.succeed(undefined),
      warn: () => Effect.succeed(undefined),
      error: () => Effect.succeed(undefined),
    })
    const githubLayer = Layer.succeed(GithubService, {
      postIssueReaction: githubServiceMock.postIssueReaction,
      findLatestPlanComment: githubServiceMock.findLatestPlanComment,
    })

    runtime = makeManagedRuntime(Layer.mergeAll(loggerLayer, kafkaLayer, githubLayer))
  }

  beforeEach(() => {
    publishedMessages = []
    githubServiceMock = {
      postIssueReaction: vi.fn(() => Effect.succeed({ ok: true })),
      findLatestPlanComment: vi.fn(() => Effect.succeed({ ok: false, reason: 'not-found' })),
    }
    provideRuntime()
  })

  afterEach(async () => {
    await runtime.dispose()
    vi.clearAllMocks()
  })

  it('rejects unsupported providers', async () => {
    const handler = createWebhookHandler({ runtime, webhooks: webhooks as never, config: baseConfig })
    const response = await handler(
      new Request('http://localhost/webhooks/slack', { method: 'POST', body: '' }),
      'slack',
    )
    expect(response.status).toBe(400)
    expect(webhooks.verify).not.toHaveBeenCalled()
    expect(publishedMessages).toHaveLength(0)
  })

  it('returns 401 when signature header missing', async () => {
    const handler = createWebhookHandler({ runtime, webhooks: webhooks as never, config: baseConfig })
    const response = await handler(buildRequest({}, {}), 'github')
    expect(response.status).toBe(401)
    expect(publishedMessages).toHaveLength(0)
  })

  it('publishes planning message on issue opened', async () => {
    const handler = createWebhookHandler({ runtime, webhooks: webhooks as never, config: baseConfig })
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
    expect(publishedMessages).toHaveLength(3)
    const [planningJsonMessage, planningStructuredMessage, rawJsonMessage] = publishedMessages

    expect(planningJsonMessage).toMatchObject({ topic: 'codex-topic', key: 'issue-1-planning' })
    expect(planningStructuredMessage).toMatchObject({
      topic: 'github.issues.codex.tasks',
      key: 'issue-1-planning',
    })
    expect(planningStructuredMessage.headers?.['content-type']).toBe('application/x-protobuf')

    const planningProto = CodexTask.fromBinary(toBuffer(planningStructuredMessage.value))
    expect(planningProto.stage).toBe(CodexTaskStage.PLANNING)
    expect(planningProto.repository).toBe('owner/repo')
    expect(planningProto.issueNumber).toBe(BigInt(1))
    expect(planningProto.deliveryId).toBe('delivery-123')

    expect(rawJsonMessage).toMatchObject({ topic: 'raw-topic', key: 'delivery-123' })
    expect(githubServiceMock.postIssueReaction).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryFullName: 'owner/repo', issueNumber: 1 }),
    )
  })

  it('publishes implementation message when trigger comment is received', async () => {
    githubServiceMock.findLatestPlanComment.mockReturnValueOnce(
      Effect.succeed({ ok: true, comment: { id: 10, body: 'Plan', htmlUrl: 'https://comment' } }),
    )

    const handler = createWebhookHandler({ runtime, webhooks: webhooks as never, config: baseConfig })
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

    expect(githubServiceMock.findLatestPlanComment).toHaveBeenCalled()
    expect(publishedMessages).toHaveLength(3)
    const [implementationJsonMessage, implementationStructuredMessage, rawJsonMessage] = publishedMessages

    expect(implementationJsonMessage).toMatchObject({ topic: 'codex-topic', key: 'issue-2-implementation' })
    expect(implementationStructuredMessage).toMatchObject({
      topic: 'github.issues.codex.tasks',
      key: 'issue-2-implementation',
    })
    expect(implementationStructuredMessage.headers?.['content-type']).toBe('application/x-protobuf')

    const implementationProto = CodexTask.fromBinary(toBuffer(implementationStructuredMessage.value))
    expect(implementationProto.stage).toBe(CodexTaskStage.IMPLEMENTATION)
    expect(implementationProto.deliveryId).toBe('delivery-999')
    expect(implementationProto.planCommentId).toBe(BigInt(10))
    expect(implementationProto.planCommentBody).toBe('Plan')
    expect(implementationProto.planCommentUrl).toBe('https://comment')

    expect(rawJsonMessage).toMatchObject({ topic: 'raw-topic', key: 'delivery-999' })
  })

  it('publishes implementation message when plan comment marker is present', async () => {
    const handler = createWebhookHandler({ runtime, webhooks: webhooks as never, config: baseConfig })
    const payload = {
      action: 'created',
      issue: {
        number: 3,
        title: 'Implementation issue',
        body: 'Body',
        html_url: 'https://issue',
      },
      repository: { default_branch: 'main' },
      sender: { login: 'github-actions[bot]' },
      comment: {
        id: 42,
        body: '## Plan\n\n- Do something\n\n<!-- codex:plan -->',
        html_url: 'https://comment/42',
      },
    }

    await handler(
      buildRequest(payload, {
        'x-github-event': 'issue_comment',
        'x-github-delivery': 'delivery-plan-marker',
        'x-hub-signature-256': 'sig',
        'content-type': 'application/json',
      }),
      'github',
    )

    expect(githubServiceMock.findLatestPlanComment).not.toHaveBeenCalled()
    expect(publishedMessages).toHaveLength(3)
    const [implementationJsonMessage, implementationStructuredMessage, rawJsonMessage] = publishedMessages

    expect(implementationJsonMessage).toMatchObject({ topic: 'codex-topic', key: 'issue-3-implementation' })
    expect(implementationStructuredMessage).toMatchObject({
      topic: 'github.issues.codex.tasks',
      key: 'issue-3-implementation',
    })
    expect(implementationStructuredMessage.headers?.['content-type']).toBe('application/x-protobuf')

    const implementationProto = CodexTask.fromBinary(toBuffer(implementationStructuredMessage.value))
    expect(implementationProto.stage).toBe(CodexTaskStage.IMPLEMENTATION)
    expect(implementationProto.issueNumber).toBe(BigInt(3))
    expect(implementationProto.planCommentId).toBe(BigInt(42))
    expect(implementationProto.planCommentBody).toContain('<!-- codex:plan -->')
    expect(implementationProto.planCommentUrl).toBe('https://comment/42')
    expect(implementationProto.deliveryId).toBe('delivery-plan-marker')

    expect(rawJsonMessage).toMatchObject({ topic: 'raw-topic', key: 'delivery-plan-marker' })
  })

  it('returns 401 when Discord signature verification fails', async () => {
    mockVerifyDiscordRequest.mockResolvedValueOnce(false)
    const handler = createWebhookHandler({ runtime, webhooks: webhooks as never, config: baseConfig })

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
    expect(publishedMessages).toHaveLength(0)
  })

  it('returns plan modal response for slash command', async () => {
    const handler = createWebhookHandler({ runtime, webhooks: webhooks as never, config: baseConfig })

    const response = await handler(
      buildDiscordRequest(
        {
          type: 2,
          id: 'interaction-123',
          token: 'token',
          data: {
            id: 'command-1',
            name: 'plan',
            type: 1,
          },
        },
        {
          'x-signature-ed25519': 'sig',
          'x-signature-timestamp': 'timestamp',
        },
      ),
      'discord',
    )

    expect(mockVerifyDiscordRequest).toHaveBeenCalled()
    expect(mockBuildPlanModalResponse).toHaveBeenCalled()
    expect(mockToPlanModalEvent).not.toHaveBeenCalled()
    expect(publishedMessages).toHaveLength(0)

    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toEqual({
      type: 9,
      data: {
        custom_id: 'plan:cmd-1',
        title: 'Request Planning Run',
        components: [],
      },
    })
  })

  it('publishes plan modal submissions and returns acknowledgement', async () => {
    const handler = createWebhookHandler({ runtime, webhooks: webhooks as never, config: baseConfig })

    const response = await handler(
      buildDiscordRequest(
        {
          type: 5,
          id: 'interaction-123',
          token: 'modal-token',
          data: { custom_id: 'plan:command-1', components: [] },
        },
        {
          'x-signature-ed25519': 'sig',
          'x-signature-timestamp': 'timestamp',
        },
      ),
      'discord',
    )

    expect(mockVerifyDiscordRequest).toHaveBeenCalled()
    expect(mockToPlanModalEvent).toHaveBeenCalled()
    expect(mockBuildPlanModalResponse).not.toHaveBeenCalled()
    expect(publishedMessages).toHaveLength(1)

    const [discordMessage] = publishedMessages
    expect(discordMessage).toMatchObject({ topic: 'discord-topic', key: 'interaction-123' })
    expect(discordMessage.headers['content-type']).toBe('application/x-protobuf')

    const protoEvent = FacteurCommandEventMessage.fromBinary(toBuffer(discordMessage.value))
    expect(protoEvent.options).toEqual(
      expect.objectContaining({
        content: 'Ship the release with QA gating',
        payload: expect.any(String),
      }),
    )

    const parsedPayload = JSON.parse(protoEvent.options.payload ?? '')
    expect(parsedPayload.prompt).toBe('Ship the release with QA gating')
    expect(parsedPayload.postToGithub).toBe(false)
    expect(parsedPayload.stage).toBe('planning')
    expect(parsedPayload.runId).toBe('interaction-123')

    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toEqual({
      type: 4,
      data: {
        content: 'Planning request received. Facteur will execute the workflow shortly.',
        flags: 64,
      },
    })
  })

  it('responds to Discord ping interactions', async () => {
    const handler = createWebhookHandler({ runtime, webhooks: webhooks as never, config: baseConfig })

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

    expect(mockBuildPlanModalResponse).not.toHaveBeenCalled()
    expect(mockToPlanModalEvent).not.toHaveBeenCalled()
    expect(publishedMessages).toHaveLength(0)
    const payload = await response.json()
    expect(payload).toEqual({ type: 1 })
  })
})

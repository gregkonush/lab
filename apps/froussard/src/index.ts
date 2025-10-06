import { Webhooks } from '@octokit/webhooks'
import { Elysia } from 'elysia'
import { Kafka } from 'kafkajs'
import type { Producer } from 'kafkajs'
import { randomUUID } from 'node:crypto'

import {
  PLAN_COMMENT_MARKER,
  buildCodexBranchName,
  buildCodexPrompt,
  normalizeLogin,
  type CodexTaskMessage,
  type Nullable,
} from './codex'
import { postIssueReaction } from './github'

const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name} environment variable`)
    process.exit(1)
  }
  return value
}

const GITHUB_WEBHOOK_SECRET = requireEnv('GITHUB_WEBHOOK_SECRET')
const KAFKA_BROKERS = requireEnv('KAFKA_BROKERS')
const KAFKA_USERNAME = requireEnv('KAFKA_USERNAME')
const KAFKA_PASSWORD = requireEnv('KAFKA_PASSWORD')
const KAFKA_TOPIC = requireEnv('KAFKA_TOPIC')
const KAFKA_CODEX_TOPIC = requireEnv('KAFKA_CODEX_TOPIC')
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? 'froussard-webhook-producer'
const CODEX_BASE_BRANCH = process.env.CODEX_BASE_BRANCH ?? 'main'
const CODEX_BRANCH_PREFIX = process.env.CODEX_BRANCH_PREFIX ?? 'codex/issue-'
const CODEX_TRIGGER_LOGIN = (process.env.CODEX_TRIGGER_LOGIN ?? 'gregkonush').toLowerCase()
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? null
const GITHUB_ACK_REACTION = process.env.GITHUB_ACK_REACTION ?? '+1'
const GITHUB_API_BASE_URL = process.env.GITHUB_API_BASE_URL ?? 'https://api.github.com'
const GITHUB_USER_AGENT = process.env.GITHUB_USER_AGENT ?? 'froussard-webhook'

const kafkaBrokers = KAFKA_BROKERS.split(',')
  .map((broker) => broker.trim())
  .filter(Boolean)

if (kafkaBrokers.length === 0) {
  console.error('No Kafka brokers configured. Set KAFKA_BROKERS to a comma-separated list of host:port values.')
  process.exit(1)
}

const webhooks = new Webhooks({ secret: GITHUB_WEBHOOK_SECRET })

// KafkaJS emits TimeoutNegativeWarning on newer Node timers while the request
// queue catches up; tracked here: https://github.com/tulios/kafkajs/issues/1751
const kafka = new Kafka({
  clientId: KAFKA_CLIENT_ID,
  brokers: kafkaBrokers,
  ssl: false,
  sasl: {
    mechanism: 'scram-sha-512',
    username: KAFKA_USERNAME,
    password: KAFKA_PASSWORD,
  },
})

const producer: Producer = kafka.producer({ allowAutoTopicCreation: false })

let producerReady = false
let producerConnectPromise: Promise<void> | null = null

const connectProducer = async (): Promise<void> => {
  const existingConnection = producerConnectPromise
  if (existingConnection) {
    return existingConnection
  }

  const connectPromise = producer
    .connect()
    .then(() => {
      producerReady = true
      console.log('Kafka producer connected')
    })
    .catch((error: unknown) => {
      producerReady = false
      producerConnectPromise = null
      console.error('Failed to connect Kafka producer:', error)
      throw error
    })

  producerConnectPromise = connectPromise
  return connectPromise
}

void connectProducer()

interface GithubUser {
  login?: Nullable<string>
}

interface GithubIssue {
  number?: Nullable<number>
  title?: Nullable<string>
  body?: Nullable<string>
  user?: Nullable<GithubUser>
  html_url?: Nullable<string>
  repository_url?: Nullable<string>
  repository?: Nullable<GithubRepository>
}

interface GithubRepository {
  full_name?: Nullable<string>
  name?: Nullable<string>
  owner?: Nullable<GithubUser>
  default_branch?: Nullable<string>
}

interface GithubIssueEventPayload {
  action?: Nullable<string>
  issue?: Nullable<GithubIssue>
  repository?: Nullable<GithubRepository>
  sender?: Nullable<GithubUser>
}

interface GithubComment {
  id?: Nullable<number>
  body?: Nullable<string>
  html_url?: Nullable<string>
  user?: Nullable<GithubUser>
}

interface GithubReaction {
  content?: Nullable<string>
}

interface GithubReactionEventPayload {
  action?: Nullable<string>
  reaction?: Nullable<GithubReaction>
  subject_type?: Nullable<string>
  issue?: Nullable<GithubIssue>
  comment?: Nullable<GithubComment>
  sender?: Nullable<GithubUser>
  repository?: Nullable<GithubRepository>
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const isGithubIssueEvent = (payload: unknown): payload is GithubIssueEventPayload => {
  if (!isRecord(payload)) {
    return false
  }
  return 'issue' in payload
}

const isGithubReactionEvent = (payload: unknown): payload is GithubReactionEventPayload => {
  if (!isRecord(payload)) {
    return false
  }
  return 'reaction' in payload
}

const deriveRepositoryFullName = (
  repository?: Nullable<GithubRepository>,
  repositoryUrl?: Nullable<string>,
): string | null => {
  if (repository && typeof repository.full_name === 'string' && repository.full_name.length > 0) {
    return repository.full_name
  }

  if (typeof repositoryUrl === 'string' && repositoryUrl.length > 0) {
    try {
      const parsed = new URL(repositoryUrl)
      const segments = parsed.pathname.split('/').filter(Boolean)
      if (segments.length >= 2) {
        const owner = segments[segments.length - 2]
        const repo = segments[segments.length - 1]
        if (owner && repo) {
          return `${owner}/${repo}`
        }
      }
    } catch (parseError: unknown) {
      console.warn(`Failed to parse repository URL '${repositoryUrl}':`, parseError)
    }
  }

  return null
}

const publishKafkaMessage = async ({
  topic,
  key,
  value,
  headers,
}: {
  topic: string
  key: string
  value: string
  headers: Record<string, string>
}): Promise<void> => {
  await connectProducer()

  try {
    await producer.send({
      topic,
      messages: [
        {
          key,
          value,
          headers,
        },
      ],
    })

    console.log(`Published Kafka message: topic=${topic}, key=${key}`)
  } catch (error: unknown) {
    producerReady = false
    producerConnectPromise = null
    console.error(`Failed to publish Kafka message to topic ${topic}:`, error)
    throw error
  }
}

const app = new Elysia()
  .get('/', () => {
    return new Response('OK', { status: 200 })
  })
  .get('/health/liveness', () => {
    console.log('Liveness check request received')
    return new Response('OK', { status: 200 })
  })
  .get('/health/readiness', () => {
    if (!producerReady) {
      console.warn('Readiness check failed: Kafka producer not connected')
      return new Response('Kafka producer not connected', { status: 503 })
    }

    console.log('Readiness check request received')
    return new Response('OK', { status: 200 })
  })
  .on('request', ({ request }) => {
    console.log(`Request: ${request.method} ${new URL(request.url).pathname}`)
  })
  .onError(({ error }) => {
    console.error('Server error:', error)
    return new Response('Internal Server Error', { status: 500 })
  })
  .post('/webhooks/:provider', async ({ request, params }) => {
    const provider = params.provider
    console.log(`Received webhook for provider: ${provider}`)

    const rawBody = await request.text()

    if (provider === 'github') {
      console.log('Attempting GitHub webhook verification...')

      const signatureHeader = request.headers.get('x-hub-signature-256')
      if (!signatureHeader) {
        console.error('Missing x-hub-signature-256 header. Available headers:', Array.from(request.headers.keys()))
        return new Response('Unauthorized', { status: 401 })
      }

      const deliveryIdHeader = request.headers.get('x-github-delivery')
      const deliveryId = deliveryIdHeader && deliveryIdHeader.length > 0 ? deliveryIdHeader : randomUUID()

      if (!(await webhooks.verify(rawBody, signatureHeader))) {
        console.error(
          `Webhook signature verification failed for delivery ${deliveryId}. Signature header: ${signatureHeader}`,
        )
        return new Response('Unauthorized', { status: 401 })
      }

      console.log('GitHub signature verified successfully.')

      let parsedPayload: unknown

      try {
        parsedPayload = JSON.parse(rawBody) as unknown
      } catch (parseError: unknown) {
        console.error('Error parsing GitHub webhook body:', parseError)
        return new Response('Invalid JSON body', { status: 400 })
      }

      const eventName = request.headers.get('x-github-event') ?? 'unknown'
      const hookId = request.headers.get('x-github-hook-id') ?? 'unknown'
      const contentType = request.headers.get('content-type') ?? 'application/json'

      const kafkaHeaders: Record<string, string> = {
        'x-github-delivery': deliveryId,
        'x-github-event': eventName,
        'x-github-hook-id': hookId,
        'content-type': contentType,
      }
      const actionValue =
        typeof (parsedPayload as { action?: unknown }).action === 'string'
          ? (parsedPayload as { action: string }).action
          : undefined

      if (actionValue) {
        kafkaHeaders['x-github-action'] = actionValue
      }

      let codexStageTriggered: string | null = null

      try {
        if (eventName === 'issues' && actionValue === 'opened' && isGithubIssueEvent(parsedPayload)) {
          const issue = parsedPayload.issue ?? undefined
          const repository = parsedPayload.repository ?? undefined
          const senderLoginValue = parsedPayload.sender?.login
          const senderLogin = typeof senderLoginValue === 'string' ? senderLoginValue : ''

          if (issue && typeof issue.number === 'number') {
            const issueAuthor = normalizeLogin(issue.user?.login)

            console.log(
              `GitHub issues event received: action=${actionValue}, issue=${issue.number}, author=${issueAuthor ?? 'unknown'}`,
            )

            if (issueAuthor === CODEX_TRIGGER_LOGIN) {
              const repositoryFullName = deriveRepositoryFullName(repository, issue.repository_url)

              if (repositoryFullName) {
                const baseBranch = repository?.default_branch ?? CODEX_BASE_BRANCH
                const headBranch = buildCodexBranchName(issue.number, deliveryId, CODEX_BRANCH_PREFIX)
                const issueTitle =
                  typeof issue.title === 'string' && issue.title.length > 0 ? issue.title : `Issue #${issue.number}`
                const issueBody = typeof issue.body === 'string' ? issue.body : ''
                const issueUrl = typeof issue.html_url === 'string' ? issue.html_url : ''
                const prompt = buildCodexPrompt({
                  stage: 'planning',
                  issueTitle,
                  issueBody,
                  repositoryFullName,
                  issueNumber: issue.number,
                  baseBranch,
                  headBranch,
                  issueUrl,
                })

                const codexMessage: CodexTaskMessage = {
                  stage: 'planning',
                  prompt,
                  repository: repositoryFullName,
                  base: baseBranch,
                  head: headBranch,
                  issueNumber: issue.number,
                  issueUrl,
                  issueTitle,
                  issueBody,
                  sender: senderLogin,
                  issuedAt: new Date().toISOString(),
                }

                await publishKafkaMessage({
                  topic: KAFKA_CODEX_TOPIC,
                  key: `issue-${issue.number}-planning`,
                  value: JSON.stringify(codexMessage),
                  headers: {
                    ...kafkaHeaders,
                    'x-codex-task-stage': 'planning',
                  },
                })

                codexStageTriggered = 'planning'
                console.log(
                  `Planning task dispatched for issue ${issue.number} to topic ${KAFKA_CODEX_TOPIC} (delivery ${deliveryId}).`,
                )

                const reactionResult = await postIssueReaction({
                  repositoryFullName,
                  issueNumber: issue.number,
                  token: GITHUB_TOKEN,
                  reactionContent: GITHUB_ACK_REACTION,
                  apiBaseUrl: GITHUB_API_BASE_URL,
                  userAgent: GITHUB_USER_AGENT,
                })

                if (reactionResult.ok) {
                  console.log(
                    `Added :${GITHUB_ACK_REACTION}: reaction to issue ${issue.number} in ${repositoryFullName} (delivery ${deliveryId}).`,
                  )
                } else {
                  const detailSuffix = reactionResult.detail ? ` Detail: ${reactionResult.detail}` : ''
                  switch (reactionResult.reason) {
                    case 'missing-token':
                      console.warn('Skipping planning acknowledgement reaction: GITHUB_TOKEN not configured.')
                      break
                    case 'invalid-repository':
                      console.warn(
                        `Skipping planning acknowledgement reaction: repository '${repositoryFullName}' is invalid.`,
                      )
                      break
                    case 'no-fetch':
                      console.warn('Skipping planning acknowledgement reaction: fetch implementation unavailable.')
                      break
                    case 'http-error':
                      console.error(
                        `GitHub API rejected reaction for issue ${issue.number} (status ${reactionResult.status ?? 'unknown'}).${detailSuffix}`,
                      )
                      break
                    case 'network-error':
                      console.error(
                        `Failed to deliver reaction for issue ${issue.number} due to network error.${detailSuffix}`,
                      )
                      break
                  }
                }
              } else {
                console.warn(
                  `Skipping planning task dispatch: repository.full_name missing for issue ${issue.number} (delivery ${deliveryId}).`,
                )
              }
            }
          }
        }

        if (eventName === 'reaction' && actionValue === 'created' && isGithubReactionEvent(parsedPayload)) {
          const reactionContent = parsedPayload.reaction?.content
          const senderLoginValue = parsedPayload.sender?.login
          const senderLogin = typeof senderLoginValue === 'string' ? senderLoginValue : ''

          if (
            (reactionContent === '+1' || reactionContent === 'thumbs_up') &&
            normalizeLogin(senderLoginValue) === CODEX_TRIGGER_LOGIN
          ) {
            const commentBody = typeof parsedPayload.comment?.body === 'string' ? parsedPayload.comment.body : ''

            if (commentBody.includes(PLAN_COMMENT_MARKER)) {
              const issue = parsedPayload.issue ?? undefined
              const reactionRepository = issue?.repository ?? parsedPayload.repository ?? undefined
              const repositoryFullName = deriveRepositoryFullName(reactionRepository, issue?.repository_url)

              const issueNumber = typeof issue?.number === 'number' ? issue.number : undefined

              if (issueNumber && repositoryFullName) {
                const baseBranch = reactionRepository?.default_branch ?? CODEX_BASE_BRANCH
                const headBranch = buildCodexBranchName(issueNumber, deliveryId, CODEX_BRANCH_PREFIX)
                const issueTitle =
                  typeof issue?.title === 'string' && issue.title.length > 0 ? issue.title : `Issue #${issueNumber}`
                const issueBody = typeof issue?.body === 'string' ? issue.body : ''
                const issueUrl = typeof issue?.html_url === 'string' ? issue.html_url : ''
                const planCommentId =
                  typeof parsedPayload.comment?.id === 'number' ? parsedPayload.comment.id : undefined
                const planCommentUrl =
                  typeof parsedPayload.comment?.html_url === 'string' ? parsedPayload.comment.html_url : undefined

                const prompt = buildCodexPrompt({
                  stage: 'implementation',
                  issueTitle,
                  issueBody,
                  repositoryFullName,
                  issueNumber,
                  baseBranch,
                  headBranch,
                  issueUrl,
                  planCommentBody: commentBody,
                })

                const codexMessage: CodexTaskMessage = {
                  stage: 'implementation',
                  prompt,
                  repository: repositoryFullName,
                  base: baseBranch,
                  head: headBranch,
                  issueNumber,
                  issueUrl,
                  issueTitle,
                  issueBody,
                  sender: senderLogin,
                  issuedAt: new Date().toISOString(),
                  planCommentId,
                  planCommentUrl,
                  planCommentBody: commentBody,
                }

                await publishKafkaMessage({
                  topic: KAFKA_CODEX_TOPIC,
                  key: `issue-${issueNumber}-implementation`,
                  value: JSON.stringify(codexMessage),
                  headers: {
                    ...kafkaHeaders,
                    'x-codex-task-stage': 'implementation',
                  },
                })

                codexStageTriggered = 'implementation'
                console.log(
                  `Implementation task dispatched for issue ${issueNumber} to topic ${KAFKA_CODEX_TOPIC} (delivery ${deliveryId}).`,
                )
              } else {
                console.warn(
                  `Skipping implementation task dispatch: missing repository or issue number for delivery ${deliveryId}.`,
                )
              }
            }
          }
        }

        await publishKafkaMessage({
          topic: KAFKA_TOPIC,
          key: deliveryId,
          value: rawBody,
          headers: kafkaHeaders,
        })

        return new Response(
          JSON.stringify({
            status: 'accepted',
            deliveryId,
            event: eventName,
            action: actionValue ?? null,
            codexStageTriggered,
          }),
          {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      } catch (error: unknown) {
        console.error('Failed to enqueue webhook event:', error)
        return new Response('Failed to enqueue webhook event', { status: 500 })
      }
    }

    console.log(`Webhook event received for unsupported provider '${provider}':`, rawBody)
    return new Response(`Provider '${provider}' not supported`, { status: 400 })
  })
  .listen(process.env.PORT || 8080)

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)

const shutdown = async () => {
  try {
    await producer.disconnect()
    console.log('Kafka producer disconnected')
  } catch (error: unknown) {
    console.error('Error disconnecting Kafka producer:', error)
  }
}

process.on('SIGINT', () => {
  void shutdown().finally(() => process.exit(0))
})

process.on('SIGTERM', () => {
  void shutdown().finally(() => process.exit(0))
})

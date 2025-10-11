import '@/telemetry'

import { Webhooks } from '@octokit/webhooks'
import { Effect } from 'effect'
import { Elysia } from 'elysia'

import { AppConfigService } from '@/effect/config'
import { makeAppRuntime } from '@/effect/runtime'
import { logger } from '@/logger'
import { createHealthHandlers } from '@/routes/health'
import { createWebhookHandler, type WebhookConfig } from '@/routes/webhooks'
import { KafkaProducer } from '@/services/kafka'

const runtime = makeAppRuntime()
const config = runtime.runSync(
  Effect.gen(function* (_) {
    return yield* AppConfigService
  }),
)
const kafka = runtime.runSync(
  Effect.gen(function* (_) {
    return yield* KafkaProducer
  }),
)

export const createApp = () => {
  const health = createHealthHandlers({ runtime, kafka })

  const webhookConfig: WebhookConfig = {
    codebase: config.codebase,
    github: config.github,
    codexTriggerLogin: config.codex.triggerLogin,
    codexImplementationTriggerPhrase: config.codex.implementationTriggerPhrase,
    topics: config.kafka.topics,
    discord: {
      publicKey: config.discord.publicKey,
      response: config.discord.defaultResponse,
    },
  }

  const webhookHandler = createWebhookHandler({
    runtime,
    webhooks: new Webhooks({ secret: config.githubWebhookSecret }),
    config: webhookConfig,
  })

  return new Elysia()
    .get('/', () => new Response('OK', { status: 200 }))
    .get('/health/liveness', health.liveness)
    .get('/health/readiness', health.readiness)
    .on('request', ({ request }) => {
      const url = new URL(request.url)
      logger.info({ method: request.method, path: url.pathname }, 'request received')
    })
    .onError(({ error }) => {
      logger.error({ err: error }, 'server error')
      return new Response('Internal Server Error', { status: 500 })
    })
    .post('/webhooks/:provider', ({ request, params }) => webhookHandler(request, params.provider))
}

export const app = createApp()

export const startServer = () => {
  if (!app.server) {
    void runtime
      .runPromise(kafka.ensureConnected)
      .catch((error) => logger.error({ err: error }, 'failed to connect Kafka producer'))

    const port = Number(process.env.PORT ?? 8080)
    app.listen(port)
    const serverInfo = (app as { server?: { hostname?: string; port?: number } }).server
    const hostname = serverInfo?.hostname ?? '0.0.0.0'
    const resolvedPort = serverInfo?.port ?? port
    logger.info({ hostname, port: resolvedPort }, 'froussard server listening')
  }

  return app
}

if (import.meta.main) {
  startServer()
}

const shutdown = async () => {
  try {
    await runtime.dispose()
  } catch (error) {
    logger.error({ err: error }, 'failed to dispose runtime')
  }
}

process.on('SIGINT', () => void shutdown().finally(() => process.exit(0)))
process.on('SIGTERM', () => void shutdown().finally(() => process.exit(0)))

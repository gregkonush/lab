import { Webhooks } from '@octokit/webhooks'
import { Elysia } from 'elysia'

import { loadConfig } from '@/config'
import { KafkaManager } from '@/services/kafka'
import { createHealthHandlers } from '@/routes/health'
import { createWebhookHandler, type WebhookConfig } from '@/routes/webhooks'

const config = loadConfig()

const kafka = new KafkaManager({
  brokers: config.kafka.brokers,
  clientId: config.kafka.clientId,
  sasl: {
    mechanism: 'scram-sha-512',
    username: config.kafka.username,
    password: config.kafka.password,
  },
})

export const createApp = () => {
  const health = createHealthHandlers(kafka)

  const webhookConfig: WebhookConfig = {
    codebase: config.codebase,
    github: config.github,
    codexTriggerLogin: config.codex.triggerLogin,
    codexImplementationTriggerPhrase: config.codex.implementationTriggerPhrase,
    codexOneShotTriggerPhrase: config.codex.oneShotTriggerPhrase,
    topics: config.kafka.topics,
  }

  const webhookHandler = createWebhookHandler({
    kafka,
    webhooks: new Webhooks({ secret: config.githubWebhookSecret }),
    config: webhookConfig,
  })

  return new Elysia()
    .get('/', () => new Response('OK', { status: 200 }))
    .get('/health/liveness', health.liveness)
    .get('/health/readiness', health.readiness)
    .on('request', ({ request }) => {
      console.log(`Request: ${request.method} ${new URL(request.url).pathname}`)
    })
    .onError(({ error }) => {
      console.error('Server error:', error)
      return new Response('Internal Server Error', { status: 500 })
    })
    .post('/webhooks/:provider', ({ request, params }) => webhookHandler(request, params.provider))
}

export const app = createApp()

export const startServer = () => {
  if (!app.server) {
    if (!kafka.isReady()) {
      void kafka.connect().then(() => console.log('Kafka producer connected'))
    }

    const port = Number(process.env.PORT ?? 8080)
    app.listen(port)
    const serverInfo = (app as any).server as { hostname?: string; port?: number } | undefined
    const hostname = serverInfo?.hostname ?? '0.0.0.0'
    const resolvedPort = serverInfo?.port ?? port
    console.log(`🦊 Elysia is running at ${hostname}:${resolvedPort}`)
  }

  return app
}

if (import.meta.main) {
  startServer()
}

const shutdown = async () => {
  try {
    await kafka.disconnect()
    console.log('Kafka producer disconnected')
  } catch (error) {
    console.error('Error disconnecting Kafka producer:', error)
  }
}

process.on('SIGINT', () => void shutdown().finally(() => process.exit(0)))
process.on('SIGTERM', () => void shutdown().finally(() => process.exit(0)))

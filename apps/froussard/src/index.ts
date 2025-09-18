import { Webhooks } from '@octokit/webhooks'
import { Elysia } from 'elysia'
import { Kafka, Producer } from 'kafkajs'
import { randomUUID } from 'node:crypto'

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
const KAFKA_CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? 'froussard-webhook-producer'

const kafkaBrokers = KAFKA_BROKERS.split(',').map((broker) => broker.trim()).filter(Boolean)

if (kafkaBrokers.length === 0) {
  console.error('No Kafka brokers configured. Set KAFKA_BROKERS to a comma-separated list of host:port values.')
  process.exit(1)
}

const webhooks = new Webhooks({ secret: GITHUB_WEBHOOK_SECRET })

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

const publishGithubEvent = async (rawBody: string, request: Request, action?: string): Promise<string> => {
  await connectProducer()

  const deliveryId = request.headers.get('x-github-delivery') ?? randomUUID()
  const eventName = request.headers.get('x-github-event') ?? 'unknown'
  const hookId = request.headers.get('x-github-hook-id') ?? 'unknown'
  const contentType = request.headers.get('content-type') ?? 'application/json'
  const headers: Record<string, string> = {
    'x-github-delivery': deliveryId,
    'x-github-event': eventName,
    'x-github-hook-id': hookId,
    'content-type': contentType,
  }

  if (action) {
    headers['x-github-action'] = action
  }

  try {
    await producer.send({
      topic: KAFKA_TOPIC,
      messages: [
        {
          key: deliveryId,
          value: rawBody,
          headers,
        },
      ],
    })

    console.log(
      `Published GitHub webhook to topic ${KAFKA_TOPIC}: event=${eventName}, action=${action ?? 'n/a'}, delivery=${deliveryId}, hook=${hookId}`,
    )
  } catch (error: unknown) {
    producerReady = false
    producerConnectPromise = null
    console.error('Failed to publish GitHub event to Kafka:', error)
    throw error
  }

  return deliveryId
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
      if (!signatureHeader || !(await webhooks.verify(rawBody, signatureHeader))) {
        console.error('Webhook signature verification failed.')
        return new Response('Unauthorized', { status: 401 })
      }

      console.log('GitHub signature verified successfully.')

      let action: string | undefined

      try {
        const parsedBody = JSON.parse(rawBody) as { action?: unknown }
        if (typeof parsedBody === 'object' && parsedBody !== null) {
          const possibleAction = (parsedBody as { action?: unknown }).action
          if (typeof possibleAction === 'string') {
            action = possibleAction
          }
        }
      } catch (parseError: unknown) {
        console.error('Error parsing GitHub webhook body:', parseError)
        return new Response('Invalid JSON body', { status: 400 })
      }

      try {
        const deliveryId = await publishGithubEvent(rawBody, request, action)
        return new Response(
          JSON.stringify({
            status: 'accepted',
            deliveryId,
            event: request.headers.get('x-github-event') ?? 'unknown',
            action: action ?? null,
          }),
          {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      } catch (error: unknown) {
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

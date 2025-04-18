import { Elysia } from 'elysia'
import { Webhooks } from '@octokit/webhooks'

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET

if (!GITHUB_WEBHOOK_SECRET) {
  console.error('Missing GITHUB_WEBHOOK_SECRET environment variable')
  process.exit(1)
}

const webhooks = new Webhooks({ secret: GITHUB_WEBHOOK_SECRET })

const app = new Elysia()
  .get('/', () => {
    return new Response('OK', { status: 200 })
  })
  .get('/health/liveness', () => {
    console.log('Liveness check request received')
    return new Response('OK', { status: 200 })
  })
  .get('/health/readiness', () => {
    console.log('Health check request received')
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

      let parsedBody: unknown
      try {
        parsedBody = JSON.parse(rawBody)
        console.log('GitHub webhook event body:', parsedBody)
      } catch (parseError) {
        console.error('Error parsing GitHub webhook body:', parseError)
        return new Response('Invalid JSON body', { status: 400 })
      }

      return new Response(JSON.stringify(parsedBody), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log(`Webhook event received for unsupported provider '${provider}':`, rawBody)
    return new Response(`Provider '${provider}' not supported`, { status: 400 })
  })
  .listen(process.env.PORT || 8080)

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)

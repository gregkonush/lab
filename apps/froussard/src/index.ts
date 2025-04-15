import { Elysia } from 'elysia'
import { createHmac } from 'node:crypto'

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET

if (!GITHUB_WEBHOOK_SECRET) {
  console.error('Missing GITHUB_WEBHOOK_SECRET environment variable')
  process.exit(1)
}

const app = new Elysia()
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
  .post('/webhooks/:provider', async ({ request, body, params }) => {
    const provider = params.provider

    if (provider === 'github') {
      const signatureHeader = request.headers.get('x-hub-signature-256')
      if (!signatureHeader) {
        console.error('Missing x-hub-signature-256 header')
        return new Response('Signature required', { status: 400 })
      }

      const rawBody = await request.text()
      const expectedSignature = `sha256=${createHmac('sha256', GITHUB_WEBHOOK_SECRET).update(rawBody).digest('hex')}`

      if (signatureHeader !== expectedSignature) {
        console.error('Invalid signature')
        return new Response('Invalid signature', { status: 403 })
      }

      console.log('GitHub webhook event received:', body)
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    console.log(`Webhook event received for unsupported provider '${provider}':`, body)
    return new Response(`Provider '${provider}' not supported`, { status: 400 })
  })
  .listen(process.env.PORT || 8080)

console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)

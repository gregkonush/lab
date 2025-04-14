import { serve } from 'bun'

serve({
  // Knative/func usually sets the PORT environment variable
  port: process.env.PORT || 8080,
  fetch(req) {
    const url = new URL(req.url)

    // Readiness probe endpoint
    if (url.pathname === '/health') {
      console.log('Health check request received')
      return new Response('OK', { status: 200 })
    }

    // Basic request logging
    console.log(`Request: ${req.method} ${url.pathname}`)

    // Default response
    return new Response(`Hello from Bun! You requested: ${url.pathname}`, {
      headers: { 'Content-Type': 'text/plain' },
    })
  },
  error(error: Error) {
    console.error('Server error:', error)
    return new Response('Internal Server Error', { status: 500 })
  },
})

console.log(`Listening on port ${process.env.PORT || 8080}...`)

import { defineEventHandler } from '@tanstack/react-start/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import { appRouter } from './routers/_app.ts'
import { toWebRequest } from '@tanstack/react-start/server'
import { createContext } from './context.ts'

export default defineEventHandler((event) => {
  const request = toWebRequest(event)
  if (!request) {
    return new Response('No request', { status: 400 })
  }

  return fetchRequestHandler({
    endpoint: '/trpc',
    req: request,
    router: appRouter,
    createContext,
  })
})

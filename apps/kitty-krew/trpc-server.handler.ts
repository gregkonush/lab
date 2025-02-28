import { defineEventHandler, toWebRequest } from '@tanstack/react-start/server'
import { initTRPC, TRPCError } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import * as k8s from '@kubernetes/client-node'

const t = initTRPC.create()

const appRouter = t.router({
  pods: t.procedure.query(async () => {
    try {
      const kc = new k8s.KubeConfig()
      kc.loadFromDefault()
      const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
      const response = await k8sApi.listPodForAllNamespaces()
      return response.items
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch pods',
        cause: error,
      })
    }
  }),
})

export type AppRouter = typeof appRouter

export default defineEventHandler((event) => {
  const request = toWebRequest(event)
  if (!request) {
    return new Response('No request', { status: 400 })
  }

  return fetchRequestHandler({
    endpoint: '/trpc',
    req: request,
    router: appRouter,
    createContext() {
      return {}
    },
  })
})

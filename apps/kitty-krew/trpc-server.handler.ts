import { defineEventHandler, toWebRequest } from '@tanstack/react-start/server'
import { initTRPC } from '@trpc/server'
import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import * as k8s from '@kubernetes/client-node'

const t = initTRPC.create()

const appRouter = t.router({
  hello: t.procedure.query(() => 'Hello world!'),
  pods: t.procedure.query(async () => {
    const kc = new k8s.KubeConfig()
    kc.loadFromDefault()
    const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
    const response = await k8sApi.listPodForAllNamespaces()
    return response.items
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

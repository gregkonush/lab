/**
 * This file contains the root router of your tRPC-backend
 */
import { createCallerFactory, router } from '../trpc'
import { podRouter } from './pod'

export const appRouter = router({
  pod: podRouter,
})

export const createCaller = createCallerFactory(appRouter)

export type AppRouter = typeof appRouter

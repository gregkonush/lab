import { TRPCError } from '@trpc/server'
import * as k8s from '@kubernetes/client-node'
import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { podListSchema, podSchema } from '~/common/schemas/pod'
import logger from '~/utils/logger'
import { createK8sClient, transformPodData } from '~/services/kubernetes'

export const podRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    try {
      // Get the Kubernetes client
      const k8sApi = await createK8sClient()

      logger.info('Fetching pods from all namespaces')
      const response = await k8sApi.listPodForAllNamespaces()
      logger.info(`Retrieved ${response.items.length} pods from Kubernetes API`)

      // Transform and validate the response with our schema
      logger.info('Transforming pod data')
      const transformedPods = response.items.map(transformPodData)

      // Validate with zod schema
      return podListSchema.parse(transformedPods)
    } catch (error) {
      logger.error('Failed during pod listing operation:', error)
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch pods',
        cause: error,
      })
    } finally {
      // Restore TLS certificate validation if it was changed
      if (process.env.NODE_ENV === 'production') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'
      }
    }
  }),

  byName: publicProcedure.input(z.object({ podName: z.string() })).query(async ({ input, ctx }) => {
    try {
      // Get the Kubernetes client
      const k8sApi = await createK8sClient()

      // Fetch all pods since we don't know the namespace from just the name
      logger.info('Fetching pods from all namespaces')
      const allPods = await k8sApi.listPodForAllNamespaces()

      // Find the pod with the specified name
      const pod = allPods.items.find((pod) => pod.metadata?.name === input.podName)

      if (!pod) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Pod with name ${input.podName} not found`,
        })
      }

      logger.info(`Found pod ${input.podName}`)

      // Transform the pod data to match our schema
      const transformedPod = transformPodData(pod)

      // Validate with zod schema
      return podSchema.parse(transformedPod)
    } catch (error) {
      logger.error(`Failed to fetch pod ${input.podName}:`, error)

      if (error instanceof TRPCError) {
        throw error
      }

      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : `Failed to fetch pod ${input.podName}`,
        cause: error,
      })
    } finally {
      // Restore TLS certificate validation if it was changed
      if (process.env.NODE_ENV === 'production') {
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'
      }
    }
  }),
})

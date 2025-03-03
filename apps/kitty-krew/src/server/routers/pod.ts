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
    }
  }),

  byName: publicProcedure
    .input(
      z.object({
        podName: z.string(),
        namespace: z.string(),
      }),
    )
    .query(async ({ input: { podName, namespace }, ctx }) => {
      try {
        // Get the Kubernetes client
        const k8sApi = await createK8sClient()

        // Use direct GET request with namespace for efficiency
        logger.info(`Fetching pod ${podName} in namespace ${namespace}`)
        try {
          const response = await k8sApi.readNamespacedPod({
            name: podName,
            namespace,
          })
          const pod = response

          logger.info(`Found pod ${podName}`)

          // Transform the pod data to match our schema
          const transformedPod = transformPodData(pod)

          // Validate with zod schema
          return podSchema.parse(transformedPod)
        } catch (err) {
          // If the pod is not found in the specified namespace, throw a NOT_FOUND error
          throw new TRPCError({
            code: 'NOT_FOUND',
            message: `Pod ${podName} not found in namespace ${namespace}`,
          })
        }
      } catch (error) {
        logger.error(`Failed to fetch pod ${podName}:`, error)

        if (error instanceof TRPCError) {
          throw error
        }

        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : `Failed to fetch pod ${podName}`,
          cause: error,
        })
      }
    }),
})

import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { router, publicProcedure } from '../trpc.ts'
import { podListSchema, podSchema } from '~/common/schemas/pod.ts'
import { logger } from '~/utils/logger.ts'
import { createK8sClient, transformPodData } from '~/services/kubernetes.ts'
import { tracked } from '@trpc/server'

export const podRouter = router({
  list: publicProcedure.query(async () => {
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
    .query(async ({ input: { podName, namespace } }) => {
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
        } catch (_err) {
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
  logs: publicProcedure
    .input(
      z.object({
        podName: z.string(),
        namespace: z.string(),
        container: z.string().optional(),
        tailLines: z.number().optional().default(100),
        sinceSeconds: z.number().optional(),
        timestamps: z.boolean().optional().default(false),
        follow: z.boolean().optional().default(false),
      }),
    )
    .query(async ({ input }) => {
      const { podName, namespace, container, tailLines, sinceSeconds, timestamps, follow } = input

      try {
        const k8sApi = await createK8sClient()
        logger.info(
          `Fetching logs for pod ${podName} in namespace ${namespace}${container ? ` container ${container}` : ''}`,
        )
        const response = await k8sApi.readNamespacedPodLog({
          name: podName,
          namespace,
          container,
          tailLines,
          sinceSeconds,
          timestamps,
          follow,
        })
        return response
      } catch (error) {
        logger.error(`Failed to fetch logs for pod ${podName}:`, error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : `Failed to fetch logs for pod ${podName}`,
          cause: error,
        })
      }
    }),

  logsStream: publicProcedure
    .input(
      z.object({
        podName: z.string(),
        namespace: z.string(),
        container: z.string().optional(),
        tailLines: z.number().optional().default(100),
        sinceSeconds: z.number().optional(),
        timestamps: z.boolean().optional().default(false),
        lastEventId: z.string().nullish(),
      }),
    )
    .subscription(async function* ({ input }) {
      const { podName, namespace, container, tailLines, sinceSeconds, timestamps, lastEventId } = input
      let lineId = Number.parseInt(lastEventId || '0', 10)

      try {
        logger.info(
          `Streaming logs for pod ${podName} in namespace ${namespace}${container ? ` container ${container}` : ''}`,
        )

        const k8sApi = await createK8sClient()

        // Start streaming logs with follow=true
        const logs = await k8sApi.readNamespacedPodLog({
          name: podName,
          namespace,
          container,
          tailLines,
          sinceSeconds,
          timestamps,
          follow: true,
        })

        // Split log string by newlines and yield each line
        const lines = logs.split('\n')
        for (const line of lines) {
          if (line.trim()) {
            lineId++
            yield tracked(lineId.toString(), line.trim())

            // Simulate delay for streaming effect
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
        }

        // If we need real-time updates, we'd use a websocket or server-sent events
        // For now, we're simulating with a complete log fetch and delayed yield
      } catch (error) {
        logger.error(`Failed to stream logs for pod ${podName}:`, error)
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: error instanceof Error ? error.message : `Failed to stream logs for pod ${podName}`,
          cause: error,
        })
      }
    }),
})

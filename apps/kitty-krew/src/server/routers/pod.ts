import { TRPCError } from '@trpc/server'
import * as k8s from '@kubernetes/client-node'
import * as fs from 'node:fs'
import { router, publicProcedure } from '../trpc'
import { podListSchema } from '~/common/schemas/pod'
import logger from '~/utils/logger'

export const podRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    try {
      const kc = new k8s.KubeConfig()

      // Check environment to use appropriate config loading
      if (process.env.NODE_ENV === 'production') {
        logger.info('Loading Kubernetes config from cluster')
        // Temporarily disable TLS certificate validation for self-signed certificates
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
        kc.loadFromCluster()

        // Load self-signed certificate if available
        const certPath = process.env.K8S_CERT_PATH || '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'
        if (fs.existsSync(certPath)) {
          logger.info(`Certificate file found at ${certPath}`)
          const cluster = kc.getCurrentCluster()
          if (cluster) {
            cluster.caFile = certPath
            // Set CA data in a way that works with the client
            try {
              const cert = fs.readFileSync(certPath, 'utf8')
              logger.info('Certificate loaded successfully')

              // Update the existing cluster instead of adding a new one
              const currentContext = kc.getCurrentContext()
              const contextObject = kc.getContextObject(currentContext)

              if (contextObject?.cluster) {
                // Instead of modifying the read-only property, create a new cluster config
                const existingCluster = kc.getCluster(contextObject.cluster)
                if (existingCluster) {
                  // Create a new cluster config with the updated CA data
                  const updatedCluster = {
                    ...existingCluster,
                    caData: cert,
                  }

                  // Remove the existing cluster and add the updated one
                  kc.clusters = kc.clusters.filter((c) => c.name !== contextObject.cluster)
                  kc.addCluster(updatedCluster)
                  logger.info(`Updated CA data for cluster: ${contextObject.cluster}`)
                }
              }
            } catch (err) {
              logger.error(`Failed to read certificate from ${certPath}:`, err)
              // Continue with existing configuration
            }
          }
        } else {
          logger.warn(`Certificate file not found at ${certPath}`)
        }
      } else {
        logger.info('Loading Kubernetes config from default settings')
        kc.loadFromDefault()
      }

      logger.info('Creating Kubernetes API client')
      const k8sApi = kc.makeApiClient(k8s.CoreV1Api)

      logger.info('Fetching pods from all namespaces')
      const response = await k8sApi.listPodForAllNamespaces()
      logger.info(`Retrieved ${response.items.length} pods from Kubernetes API`)

      // Transform and validate the response with our schema
      logger.info('Transforming pod data')
      const transformedPods = response.items.map((pod) => ({
        metadata: {
          name: pod.metadata?.name || '',
          namespace: pod.metadata?.namespace || '',
          uid: pod.metadata?.uid || '',
          creationTimestamp: pod.metadata?.creationTimestamp || '',
        },
        status: {
          phase: pod.status?.phase || '',
          conditions: pod.status?.conditions || [],
          hostIP: pod.status?.hostIP || '',
          podIP: pod.status?.podIP || '',
          startTime: pod.status?.startTime || '',
          containerStatuses: pod.status?.containerStatuses || [],
        },
        spec: {
          nodeName: pod.spec?.nodeName || '',
          containers: pod.spec?.containers || [],
        },
      }))

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
})

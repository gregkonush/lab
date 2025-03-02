import { TRPCError } from '@trpc/server'
import * as k8s from '@kubernetes/client-node'
import * as fs from 'node:fs'
import { router, publicProcedure } from '../trpc'
import { podListSchema } from '~/common/schemas/pod'

export const podRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    try {
      const kc = new k8s.KubeConfig()

      // Check environment to use appropriate config loading
      if (process.env.NODE_ENV === 'production') {
        kc.loadFromCluster()

        // Load self-signed certificate if available
        const certPath = process.env.K8S_CERT_PATH || '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'
        if (fs.existsSync(certPath)) {
          const cluster = kc.getCurrentCluster()
          if (cluster) {
            cluster.caFile = certPath
            // Set CA data in a way that works with the client
            const cert = fs.readFileSync(certPath, 'utf8')
            kc.addCluster({
              ...cluster,
              caData: cert,
              server: cluster.server,
            })
          }
        }
      } else {
        kc.loadFromDefault()
      }

      const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
      const response = await k8sApi.listPodForAllNamespaces()

      // Transform and validate the response with our schema
      const transformedPods = response.items.map((pod) => ({
        metadata: {
          name: pod.metadata?.name,
          namespace: pod.metadata?.namespace,
          creationTimestamp: pod.metadata?.creationTimestamp?.toISOString(),
          uid: pod.metadata?.uid,
        },
        status: {
          phase: pod.status?.phase,
          podIP: pod.status?.podIP,
        },
      }))

      // Validate with zod schema
      return podListSchema.parse(transformedPods)
    } catch (error) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: error instanceof Error ? error.message : 'Failed to fetch pods',
        cause: error,
      })
    }
  }),
})

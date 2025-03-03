import * as k8s from '@kubernetes/client-node'
import * as fs from 'node:fs'
import logger from '~/utils/logger'
import type { Pod } from '~/common/schemas/pod'

/**
 * Creates and configures a Kubernetes API client
 * @returns A configured Kubernetes CoreV1Api client
 */
export async function createK8sClient(): Promise<k8s.CoreV1Api> {
  const kc = new k8s.KubeConfig()

  try {
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
    return kc.makeApiClient(k8s.CoreV1Api)
  } catch (error) {
    logger.error('Failed to create Kubernetes client:', error)
    throw error
  }
}

/**
 * Transforms a Kubernetes pod object to our application's schema format
 * @param pod The Kubernetes pod object
 * @returns A transformed pod object matching our schema
 */
export function transformPodData(pod: k8s.V1Pod): Pod {
  // Process the creation timestamp to match our schema
  let creationTimestamp: Date | undefined = undefined
  if (pod.metadata?.creationTimestamp) {
    creationTimestamp = new Date(pod.metadata.creationTimestamp)
  }

  return {
    metadata: {
      name: pod.metadata?.name || '',
      namespace: pod.metadata?.namespace || '',
      uid: pod.metadata?.uid || '',
      creationTimestamp,
    },
    status: {
      phase: pod.status?.phase || '',
      podIP: pod.status?.podIP || '',
      hostIP: pod.status?.hostIP || '',
    },
    spec: {
      nodeName: pod.spec?.nodeName || '',
      containers:
        pod.spec?.containers?.map((container) => ({
          name: container.name,
          image: container.image,
          ports: container.ports?.map((port) => ({
            containerPort: port.containerPort,
            protocol: port.protocol,
          })),
        })) || [],
    },
  }
}

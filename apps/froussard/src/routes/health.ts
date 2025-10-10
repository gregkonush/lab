import { logger } from '@/logger'
import type { KafkaManager } from '@/services/kafka'

export interface HealthHandlers {
  liveness: () => Response
  readiness: () => Response
}

export const createHealthHandlers = (kafka: KafkaManager): HealthHandlers => {
  return {
    liveness: () => {
      logger.debug('Liveness check request received')
      return new Response('OK', { status: 200 })
    },
    readiness: () => {
      if (!kafka.isReady()) {
        logger.warn('Readiness check failed: Kafka producer not connected')
        return new Response('Kafka producer not connected', { status: 503 })
      }
      logger.debug('Readiness check request received')
      return new Response('OK', { status: 200 })
    },
  }
}

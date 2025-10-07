import type { KafkaManager } from '@/services/kafka'

export interface HealthHandlers {
  liveness: () => Response
  readiness: () => Response
}

export const createHealthHandlers = (kafka: KafkaManager): HealthHandlers => {
  return {
    liveness: () => {
      console.log('Liveness check request received')
      return new Response('OK', { status: 200 })
    },
    readiness: () => {
      if (!kafka.isReady()) {
        console.warn('Readiness check failed: Kafka producer not connected')
        return new Response('Kafka producer not connected', { status: 503 })
      }
      console.log('Readiness check request received')
      return new Response('OK', { status: 200 })
    },
  }
}

import { logger } from '@/logger'
import type { KafkaMessage, KafkaManager } from '@/services/kafka'

export const publishKafkaMessage = async (kafka: KafkaManager, message: KafkaMessage): Promise<void> => {
  await kafka.publish(message)
  logger.info({ topic: message.topic, key: message.key }, 'published kafka message')
}

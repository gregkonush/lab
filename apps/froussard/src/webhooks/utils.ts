import type { KafkaMessage, KafkaManager } from '@/services/kafka'

export const publishKafkaMessage = async (kafka: KafkaManager, message: KafkaMessage): Promise<void> => {
  await kafka.publish(message)
  console.log(`Published Kafka message: topic=${message.topic}, key=${message.key}`)
}

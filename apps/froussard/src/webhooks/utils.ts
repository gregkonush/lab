import { Effect } from 'effect'

import { AppLogger } from '@/logger'
import { KafkaProducer, type KafkaMessage } from '@/services/kafka'

export const publishKafkaMessage = (message: KafkaMessage): Effect.Effect<void> =>
  Effect.gen(function* (_) {
    const kafka = yield* KafkaProducer
    const logger = yield* AppLogger
    yield* kafka.publish(message)
    yield* logger.info('published kafka message', { topic: message.topic, key: message.key })
  })

import { Effect, Layer, Ref } from 'effect'
import { Kafka } from 'kafkajs'

import { AppConfigService } from '@/effect/config'
import { AppLogger } from '@/logger'

export interface KafkaMessage {
  topic: string
  key: string
  value: string
  headers: Record<string, string>
}

export interface KafkaProducerService {
  readonly publish: (message: KafkaMessage) => Effect.Effect<void>
  readonly ensureConnected: Effect.Effect<void>
  readonly isReady: Effect.Effect<boolean>
}

export class KafkaProducer extends Effect.Tag('@froussard/KafkaProducer')<KafkaProducer, KafkaProducerService>() {}

export const KafkaProducerLayer = Layer.scoped(
  KafkaProducer,
  Effect.gen(function* (_) {
    const config = yield* AppConfigService
    const logger = yield* AppLogger

    const kafka = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      ssl: false,
      sasl: {
        mechanism: 'scram-sha-512',
        username: config.kafka.username,
        password: config.kafka.password,
      },
    })

    const createProducer = () => kafka.producer({ allowAutoTopicCreation: false })
    let producer = createProducer()
    const readyRef = yield* Ref.make(false)

    const connect = Effect.tryPromise(() => producer.connect()).pipe(
      Effect.tap(() => Ref.set(readyRef, true)),
      Effect.tap(() =>
        logger.info('Kafka producer connected', {
          clientId: config.kafka.clientId,
          brokers: config.kafka.brokers.join(','),
        }),
      ),
    )

    const disconnect = Effect.tryPromise(() => producer.disconnect()).pipe(
      Effect.tap(() => Ref.set(readyRef, false)),
      Effect.tap(() => logger.info('Kafka producer disconnected', { clientId: config.kafka.clientId })),
    )

    const ensureConnected = Ref.get(readyRef).pipe(Effect.flatMap((ready) => (ready ? Effect.void : connect)))

    const resetProducer = Effect.sync(() => {
      producer = createProducer()
    })

    const publish = (message: KafkaMessage) =>
      ensureConnected.pipe(
        Effect.flatMap(() =>
          Effect.tryPromise({
            try: () =>
              producer.send({
                topic: message.topic,
                messages: [
                  {
                    key: message.key,
                    value: message.value,
                    headers: message.headers,
                  },
                ],
              }),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          }).pipe(
            Effect.tap(() =>
              logger.info('published kafka message', {
                topic: message.topic,
                key: message.key,
              }),
            ),
            Effect.tapError((error) =>
              Ref.set(readyRef, false).pipe(
                Effect.zipRight(
                  Effect.tryPromise(() => producer.disconnect()).pipe(Effect.catchAll(() => Effect.succeed(undefined))),
                ),
                Effect.zipRight(resetProducer),
                Effect.zipRight(
                  logger.error('failed to publish kafka message', {
                    err: error instanceof Error ? error.message : String(error),
                    topic: message.topic,
                    key: message.key,
                  }),
                ),
              ),
            ),
          ),
        ),
      )

    const isReady = Ref.get(readyRef)

    return yield* Effect.acquireRelease(
      Effect.succeed<KafkaProducerService>({
        publish,
        ensureConnected,
        isReady,
      }),
      () => disconnect.pipe(Effect.zipRight(resetProducer)),
    )
  }),
)

export const parseBrokerList = (raw: string): string[] => {
  return raw
    .split(',')
    .map((broker) => broker.trim())
    .filter((broker) => broker.length > 0)
}

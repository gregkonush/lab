import { Kafka, logLevel as kafkaLogLevel, type SASLOptions } from 'kafkajs'
import pino from 'pino'
import { Resend } from 'resend'

import { getConfig } from './config'
import { IdempotencyCache, startCourrielConsumer } from './runner'

const config = getConfig()

const logger = pino({
  name: 'courriel',
  level: config.logging.level,
})

const kafka = new Kafka({
  clientId: config.kafka.clientId,
  brokers: config.kafka.brokers,
  ssl: config.kafka.ssl,
  sasl: config.kafka.sasl as SASLOptions,
  logLevel: kafkaLogLevel.NOTHING,
})

const consumer = kafka.consumer({
  groupId: config.kafka.groupId,
  allowAutoTopicCreation: false,
})

const resend = new Resend(config.resend.apiKey)
const idempotencyCache = new IdempotencyCache(2048)

const shutdown = async () => {
  logger.info('shutting down courriel consumer')
  await consumer.disconnect().catch((error) => {
    logger.error({ err: error }, 'failed to disconnect Kafka consumer')
  })
}

process.on('SIGINT', () => {
  shutdown().finally(() => process.exit(0))
})

process.on('SIGTERM', () => {
  shutdown().finally(() => process.exit(0))
})

startCourrielConsumer({
  config,
  logger,
  kafkaConsumer: consumer,
  resend,
  idempotencyCache,
})
  .then(() => {
    logger.info('courriel consumer exited')
  })
  .catch((error) => {
    logger.fatal({ err: error }, 'courriel consumer terminated with an error')
    void shutdown().finally(() => process.exit(1))
  })

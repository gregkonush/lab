import type { Consumer, EachMessagePayload } from 'kafkajs'
import type { Logger } from 'pino'
import type { Resend } from 'resend'

import type { AppConfig } from './config'
import { buildCompletionEmail } from './email/completion'
import { parseCompletion } from './schema/completion'

export class IdempotencyCache {
  private readonly maxSize: number
  private readonly entries = new Map<string, number>()

  constructor(maxSize = 1024) {
    this.maxSize = maxSize
  }

  has(id: string): boolean {
    return this.entries.has(id)
  }

  add(id: string): void {
    if (this.entries.has(id)) {
      this.entries.delete(id)
    }

    this.entries.set(id, Date.now())

    if (this.entries.size > this.maxSize) {
      const iterator = this.entries.keys().next()
      if (!iterator.done) {
        this.entries.delete(iterator.value)
      }
    }
  }
}

export interface MessageProcessorDependencies {
  config: AppConfig
  resend: Resend
  logger: Logger
  idempotencyCache?: IdempotencyCache
}

export const createMessageProcessor = ({
  config,
  resend,
  logger,
  idempotencyCache = new IdempotencyCache(),
}: MessageProcessorDependencies) => {
  return async ({ topic, partition, message }: EachMessagePayload): Promise<void> => {
    const rawKey = message.key?.toString('utf8') ?? undefined
    const rawValue = message.value?.toString('utf8')

    if (!rawValue) {
      logger.warn({ topic, partition, offset: message.offset }, 'received message without a value – skipping')
      return
    }

    let completion
    try {
      const parsed = JSON.parse(rawValue)
      completion = parseCompletion(parsed)
    } catch (error) {
      logger.error(
        {
          err: error,
          topic,
          partition,
          offset: message.offset,
        },
        'failed to parse workflow completion payload',
      )
      return
    }

    const dedupeId = rawKey ?? completion.metadata.uid
    if (dedupeId && idempotencyCache.has(dedupeId)) {
      logger.debug({ dedupeId, topic, partition, offset: message.offset }, 'duplicate completion skipped')
      return
    }

    const email = buildCompletionEmail(completion, config)

    if (email.to.length === 0) {
      logger.warn(
        {
          dedupeId,
          topic,
          partition,
          offset: message.offset,
          metadata: completion.metadata,
        },
        'workflow completion has no resolved recipients – skipping email',
      )
      return
    }

    try {
      const response = await resend.emails.send({
        from: email.from,
        to: email.to,
        cc: email.cc.length > 0 ? email.cc : undefined,
        bcc: email.bcc.length > 0 ? email.bcc : undefined,
        subject: email.subject,
        html: email.html,
        text: email.text,
        replyTo: email.replyTo,
        headers: email.headers,
      })

      if (response.error) {
        throw new Error(`Resend API error: ${response.error.message}`)
      }

      const messageId = response.data?.id ?? null

      if (dedupeId) {
        idempotencyCache.add(dedupeId)
      }

      logger.info(
        {
          dedupeId,
          topic,
          partition,
          offset: message.offset,
          resendId: messageId ?? undefined,
        },
        'email delivered for workflow completion',
      )
    } catch (error) {
      logger.error(
        {
          err: error,
          dedupeId,
          topic,
          partition,
          offset: message.offset,
        },
        'failed to deliver Resend notification',
      )
      throw error
    }
  }
}

export interface CourrielConsumerDependencies {
  config: AppConfig
  logger: Logger
  kafkaConsumer: Consumer
  resend: Resend
  idempotencyCache?: IdempotencyCache
}

export const startCourrielConsumer = async ({
  config,
  logger,
  kafkaConsumer,
  resend,
  idempotencyCache,
}: CourrielConsumerDependencies): Promise<void> => {
  const processor = createMessageProcessor({
    config,
    resend,
    logger,
    idempotencyCache,
  })

  await kafkaConsumer.connect()
  await kafkaConsumer.subscribe({ topic: config.kafka.topic, fromBeginning: false })
  await kafkaConsumer.run({ eachMessage: processor })
}

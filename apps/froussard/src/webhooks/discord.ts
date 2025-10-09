import {
  buildDeferredResponsePayload,
  INTERACTION_TYPE,
  toCommandEvent,
  verifyDiscordRequest,
} from '@/discord-commands'
import type { KafkaManager } from '@/services/kafka'

import type { WebhookConfig } from './types'
import { publishKafkaMessage } from './utils'

const decoder = new TextDecoder()

export interface DiscordWebhookDependencies {
  kafka: KafkaManager
  config: WebhookConfig
}

export const createDiscordWebhookHandler =
  ({ kafka, config }: DiscordWebhookDependencies) =>
  async (body: Uint8Array, headers: Headers): Promise<Response> => {
    if (!(await verifyDiscordRequest(body, headers, config.discord.publicKey))) {
      console.error('Discord signature verification failed. Headers:', Array.from(headers.keys()))
      return new Response('Unauthorized', { status: 401 })
    }

    const rawBodyText = decoder.decode(body)

    let interaction: unknown
    try {
      interaction = JSON.parse(rawBodyText) as unknown
    } catch (error) {
      console.error('Failed to parse Discord interaction payload:', error)
      return new Response('Invalid JSON body', { status: 400 })
    }

    const typedInteraction = interaction as { type?: number }

    if (typedInteraction.type === INTERACTION_TYPE.PING) {
      return new Response(JSON.stringify({ type: INTERACTION_TYPE.PING }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (typedInteraction.type !== INTERACTION_TYPE.APPLICATION_COMMAND) {
      console.warn('Received unsupported Discord interaction type:', typedInteraction.type)
      return new Response(
        JSON.stringify({
          type: 4,
          data: { content: 'Unsupported interaction type', flags: 1 << 6 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    let event
    try {
      event = toCommandEvent(interaction as any, config.discord.response)
    } catch (error) {
      console.error('Error normalising Discord interaction:', error)
      return new Response(
        JSON.stringify({
          type: 4,
          data: { content: 'Command payload invalid', flags: 1 << 6 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    const kafkaHeaders: Record<string, string> = {
      'content-type': 'application/json',
      'x-discord-interaction-type': String(typedInteraction.type),
      'x-discord-command-name': event.command,
      'x-discord-command-id': event.commandId,
      'x-discord-application-id': event.applicationId,
    }

    if (event.guildId) {
      kafkaHeaders['x-discord-guild-id'] = event.guildId
    }
    if (event.channelId) {
      kafkaHeaders['x-discord-channel-id'] = event.channelId
    }
    if (event.user.id) {
      kafkaHeaders['x-discord-user-id'] = event.user.id
    }

    await publishKafkaMessage(kafka, {
      topic: config.topics.discordCommands,
      key: event.interactionId,
      value: JSON.stringify(event),
      headers: kafkaHeaders,
    })

    const responsePayload = buildDeferredResponsePayload(config.discord.response)

    return new Response(JSON.stringify(responsePayload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

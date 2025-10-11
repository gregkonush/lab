import {
  buildPlanModalResponse,
  type DiscordApplicationCommandInteraction,
  type DiscordCommandEvent,
  type DiscordModalSubmitInteraction,
  INTERACTION_TYPE,
  toPlanModalEvent,
  verifyDiscordRequest,
} from '@/discord-commands'
import type { AppRuntime } from '@/effect/runtime'
import { logger } from '@/logger'

import type { WebhookConfig } from './types'
import { publishKafkaMessage } from './utils'

const decoder = new TextDecoder()
const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
const EPHEMERAL_FLAG = 1 << 6

export interface DiscordWebhookDependencies {
  runtime: AppRuntime
  config: WebhookConfig
}

export const createDiscordWebhookHandler =
  ({ runtime, config }: DiscordWebhookDependencies) =>
  async (body: Uint8Array, headers: Headers): Promise<Response> => {
    if (!(await verifyDiscordRequest(body, headers, config.discord.publicKey))) {
      logger.error({ headers: Array.from(headers.keys()) }, 'discord signature verification failed')
      return new Response('Unauthorized', { status: 401 })
    }

    const rawBodyText = decoder.decode(body)

    let interaction: unknown
    try {
      interaction = JSON.parse(rawBodyText) as unknown
    } catch (error) {
      logger.error({ err: error }, 'failed to parse discord interaction payload')
      return new Response('Invalid JSON body', { status: 400 })
    }

    const typedInteraction = interaction as { type?: number }

    if (typedInteraction.type === INTERACTION_TYPE.PING) {
      return jsonResponse({ type: INTERACTION_TYPE.PING })
    }

    if (typedInteraction.type === INTERACTION_TYPE.APPLICATION_COMMAND) {
      const commandInteraction = interaction as DiscordApplicationCommandInteraction
      const commandName = commandInteraction.data?.name?.toLowerCase()

      if (commandName !== 'plan') {
        logger.warn({ commandName }, 'unsupported discord command')
        return jsonResponse({
          type: 4,
          data: { content: 'Unsupported command. Try `/plan`.', flags: EPHEMERAL_FLAG },
        })
      }

      try {
        const modal = buildPlanModalResponse(commandInteraction)
        return jsonResponse(modal)
      } catch (error) {
        logger.error({ err: error }, 'failed to build plan modal')
        return jsonResponse({
          type: 4,
          data: { content: 'Command payload invalid', flags: EPHEMERAL_FLAG },
        })
      }
    }

    if (typedInteraction.type === INTERACTION_TYPE.MODAL_SUBMIT) {
      let event: DiscordCommandEvent
      try {
        event = toPlanModalEvent(interaction as DiscordModalSubmitInteraction, config.discord.response)
      } catch (error) {
        logger.error({ err: error }, 'failed to normalise plan modal submission')
        return jsonResponse({
          type: 4,
          data: { content: 'Modal payload invalid', flags: EPHEMERAL_FLAG },
        })
      }

      const rawContent = (event.options.content ?? '').toString().trim()
      const promptContent = rawContent.length > 0 ? rawContent : 'Provide a planning summary.'
      const firstLine = promptContent.split('\n')[0]?.trim() ?? ''
      const derivedTitle = firstLine.length > 0 ? firstLine : 'Discord planning request'
      const planTitle = derivedTitle.length > 120 ? `${derivedTitle.slice(0, 119)}…` : derivedTitle

      const planPayload: Record<string, unknown> = {
        stage: 'planning',
        prompt: promptContent,
        title: planTitle,
        repository: '',
        issueNumber: '',
        postToGithub: false,
        runId: event.interactionId,
        issuedAt: event.timestamp,
        guildId: event.guildId,
        channelId: event.channelId,
        user: {
          id: event.user.id,
          username: event.user.username,
          globalName: event.user.globalName,
        },
      }

      event.options = {
        content: promptContent,
        payload: JSON.stringify(planPayload),
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

      await runtime.runPromise(
        publishKafkaMessage({
          topic: config.topics.discordCommands,
          key: event.interactionId,
          value: JSON.stringify(event),
          headers: kafkaHeaders,
        }),
      )

      return jsonResponse({
        type: 4,
        data: {
          content: 'Planning request received. Facteur will execute the workflow shortly.',
          ...(config.discord.response.ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
        },
      })
    }

    logger.warn({ interactionType: typedInteraction.type }, 'unsupported discord interaction type')
    return jsonResponse({
      type: 4,
      data: { content: 'Unsupported interaction type', flags: EPHEMERAL_FLAG },
    })
  }

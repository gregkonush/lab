import type { Webhooks } from '@octokit/webhooks'

import { logger } from '@/logger'
import type { KafkaManager } from '@/services/kafka'

import { createDiscordWebhookHandler } from './discord'
import { createGithubWebhookHandler } from './github'
import type { WebhookConfig } from './types'

export type { WebhookConfig } from './types'

interface WebhookDependencies {
  kafka: KafkaManager
  webhooks: Webhooks
  config: WebhookConfig
}

export const createWebhookHandler = ({ kafka, webhooks, config }: WebhookDependencies) => {
  const discordHandler = createDiscordWebhookHandler({ kafka, config })
  const githubHandler = createGithubWebhookHandler({ kafka, webhooks, config })

  return async (request: Request, provider: string): Promise<Response> => {
    logger.info({ provider }, 'webhook request received')

    if (provider === 'discord') {
      const bodyBuffer = new Uint8Array(await request.arrayBuffer())
      return discordHandler(bodyBuffer, request.headers)
    }

    if (provider !== 'github') {
      const preview = await request.text()
      logger.warn({ provider, preview }, 'unsupported webhook provider')
      return new Response(`Provider '${provider}' not supported`, { status: 400 })
    }

    const rawBody = await request.text()
    return githubHandler(rawBody, request)
  }
}

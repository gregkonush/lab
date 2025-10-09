import { Webhooks } from '@octokit/webhooks'

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
    console.log(`Received webhook for provider: ${provider}`)

    if (provider === 'discord') {
      const bodyBuffer = new Uint8Array(await request.arrayBuffer())
      return discordHandler(bodyBuffer, request.headers)
    }

    if (provider !== 'github') {
      const preview = await request.text()
      console.log(`Webhook event received for unsupported provider '${provider}':`, preview)
      return new Response(`Provider '${provider}' not supported`, { status: 400 })
    }

    const rawBody = await request.text()
    return githubHandler(rawBody, request)
  }
}

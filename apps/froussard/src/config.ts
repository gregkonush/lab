import { parseBrokerList } from '@/utils/kafka'

const requireEnv = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

export interface AppConfig {
  githubWebhookSecret: string
  kafka: {
    brokers: string[]
    username: string
    password: string
    clientId: string
    topics: {
      raw: string
      codex: string
      codexStructured: string
      discordCommands: string
    }
  }
  codebase: {
    baseBranch: string
    branchPrefix: string
  }
  codex: {
    triggerLogin: string
    workflowLogin: string
    implementationTriggerPhrase: string
  }
  discord: {
    publicKey: string
    defaultResponse: {
      deferType: 'channel-message'
      ephemeral: boolean
    }
  }
  github: {
    token: string | null
    ackReaction: string
    apiBaseUrl: string
    userAgent: string
  }
}

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => {
  const brokers = parseBrokerList(requireEnv(env, 'KAFKA_BROKERS'))
  if (brokers.length === 0) {
    throw new Error('KAFKA_BROKERS must include at least one broker host:port')
  }

  return {
    githubWebhookSecret: requireEnv(env, 'GITHUB_WEBHOOK_SECRET'),
    kafka: {
      brokers,
      username: requireEnv(env, 'KAFKA_USERNAME'),
      password: requireEnv(env, 'KAFKA_PASSWORD'),
      clientId: env.KAFKA_CLIENT_ID ?? 'froussard-webhook-producer',
      topics: {
        raw: requireEnv(env, 'KAFKA_TOPIC'),
        codex: requireEnv(env, 'KAFKA_CODEX_TOPIC'),
        codexStructured: requireEnv(env, 'KAFKA_CODEX_TOPIC_STRUCTURED'),
        discordCommands: requireEnv(env, 'KAFKA_DISCORD_COMMAND_TOPIC'),
      },
    },
    codebase: {
      baseBranch: env.CODEX_BASE_BRANCH ?? 'main',
      branchPrefix: env.CODEX_BRANCH_PREFIX ?? 'codex/issue-',
    },
    codex: {
      triggerLogin: (env.CODEX_TRIGGER_LOGIN ?? 'gregkonush').toLowerCase(),
      workflowLogin:
        typeof env.CODEX_WORKFLOW_LOGIN === 'string' && env.CODEX_WORKFLOW_LOGIN.trim().length > 0
          ? env.CODEX_WORKFLOW_LOGIN.trim().toLowerCase()
          : 'github-actions[bot]',
      implementationTriggerPhrase: (env.CODEX_IMPLEMENTATION_TRIGGER ?? 'execute plan').trim(),
    },
    discord: {
      publicKey: requireEnv(env, 'DISCORD_PUBLIC_KEY'),
      defaultResponse: {
        deferType: 'channel-message',
        ephemeral: (env.DISCORD_DEFAULT_EPHEMERAL ?? 'true').toLowerCase() === 'true',
      },
    },
    github: {
      token: env.GITHUB_TOKEN ?? null,
      ackReaction: env.GITHUB_ACK_REACTION ?? '+1',
      apiBaseUrl: env.GITHUB_API_BASE_URL ?? 'https://api.github.com',
      userAgent: env.GITHUB_USER_AGENT ?? 'froussard-webhook',
    },
  }
}

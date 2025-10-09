import { verifyKey } from 'discord-interactions'

const SIGNATURE_HEADER = 'x-signature-ed25519'
const TIMESTAMP_HEADER = 'x-signature-timestamp'

export const INTERACTION_TYPE = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
} as const

export type InteractionType = (typeof INTERACTION_TYPE)[keyof typeof INTERACTION_TYPE]

export interface DiscordInteraction {
  type: InteractionType
  id: string
  token: string
  version: number
  application_id: string
  data?: DiscordApplicationCommandData
  guild_id?: string
  channel_id?: string
  member?: DiscordGuildMember
  user?: DiscordUser
  locale?: string
  guild_locale?: string
}

export interface DiscordApplicationCommandData {
  id: string
  name: string
  type: number
  options?: DiscordApplicationCommandOption[]
}

export interface DiscordApplicationCommandOption {
  name: string
  type: number
  value?: unknown
  options?: DiscordApplicationCommandOption[]
}

export interface DiscordGuildMember {
  user?: DiscordUser
  roles?: string[]
  permissions?: string
}

export interface DiscordUser {
  id: string
  username?: string
  global_name?: string | null
  discriminator?: string
}

export interface DiscordResponseConfig {
  deferType: 'channel-message'
  ephemeral: boolean
}

export interface DiscordCommandEvent {
  provider: 'discord'
  interactionId: string
  applicationId: string
  command: string
  commandId: string
  version: number
  token: string
  options: Record<string, string>
  guildId?: string
  channelId?: string
  user: {
    id: string
    username?: string
    globalName?: string | null
    discriminator?: string
  }
  member?: {
    id?: string
    roles?: string[]
  }
  locale?: string
  guildLocale?: string
  response: {
    type: number
    flags?: number
  }
  timestamp: string
}

export const verifyDiscordRequest = async (
  rawBody: Uint8Array,
  headers: Headers,
  publicKey: string,
): Promise<boolean> => {
  const signature = headers.get(SIGNATURE_HEADER)
  const timestamp = headers.get(TIMESTAMP_HEADER)

  if (!signature || !timestamp) {
    return false
  }

  try {
    return await verifyKey(rawBody, signature, timestamp, publicKey)
  } catch (error) {
    console.error('Discord signature verification error:', error)
    return false
  }
}

export const buildDeferredResponsePayload = (config: DiscordResponseConfig) => {
  const flags = config.ephemeral ? 1 << 6 : undefined
  return {
    type: config.deferType === 'channel-message' ? 5 : 5,
    data: flags ? { flags } : undefined,
  }
}

export const toCommandEvent = (
  interaction: DiscordInteraction,
  responseConfig: DiscordResponseConfig,
): DiscordCommandEvent => {
  if (interaction.type !== INTERACTION_TYPE.APPLICATION_COMMAND) {
    throw new Error(`Unsupported interaction type: ${interaction.type}`)
  }

  if (!interaction.data) {
    throw new Error('Missing interaction data for command')
  }

  if (!interaction.id || !interaction.token) {
    throw new Error('Interaction missing id or token')
  }

  const commandName = interaction.data.name
  const commandId = interaction.data.id

  if (!commandName || !commandId) {
    throw new Error('Interaction missing command metadata')
  }

  const options = flattenOptions(interaction.data.options)
  const user = resolveUser(interaction)

  return {
    provider: 'discord',
    interactionId: interaction.id,
    applicationId: interaction.application_id,
    command: commandName,
    commandId,
    version: interaction.version,
    token: interaction.token,
    options,
    guildId: interaction.guild_id,
    channelId: interaction.channel_id,
    user: {
      id: user?.id ?? '',
      username: user?.username,
      globalName: user?.global_name ?? null,
      discriminator: user?.discriminator,
    },
    member: interaction.member
      ? {
          id: interaction.member.user?.id,
          roles: interaction.member.roles ?? [],
        }
      : undefined,
    locale: interaction.locale,
    guildLocale: interaction.guild_locale,
    response: {
      type: 5,
      ...(responseConfig.ephemeral ? { flags: 1 << 6 } : {}),
    },
    timestamp: new Date().toISOString(),
  }
}

const flattenOptions = (options?: DiscordApplicationCommandOption[]): Record<string, string> => {
  const result: Record<string, string> = {}

  if (!options || options.length === 0) {
    return result
  }

  const visit = (opts: DiscordApplicationCommandOption[], path: string[] = []) => {
    for (const option of opts) {
      const nextPath = [...path, option.name]
      if (option.options && option.options.length > 0) {
        visit(option.options, nextPath)
      }

      if (option.value !== undefined) {
        const key = nextPath.join('.')
        result[key] = toStringValue(option.value)
      }
    }
  }

  visit(options)

  return result
}

const toStringValue = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }

  return JSON.stringify(value)
}

const resolveUser = (interaction: DiscordInteraction): DiscordUser | undefined => {
  return interaction.member?.user ?? interaction.user
}

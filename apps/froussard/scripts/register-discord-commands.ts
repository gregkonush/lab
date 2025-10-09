const requireEnv = (name: string): string => {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

interface CommandOption {
  name: string
  description: string
  type: number
  required?: boolean
}

interface SlashCommand {
  name: string
  description: string
  options?: CommandOption[]
}

const commands: SlashCommand[] = [
  {
    name: 'plan',
    description: 'Shape upcoming work and capture acceptance checkpoints.',
    options: [
      { name: 'objective', description: 'Short description of the desired outcome', type: 3, required: true },
      { name: 'project', description: 'Project or repository slug (optional)', type: 3 },
    ],
  },
  {
    name: 'implement',
    description: 'Kick off execution for an approved plan.',
    options: [
      { name: 'project', description: 'Project or repository slug', type: 3, required: true },
      { name: 'branch', description: 'Git branch name to use', type: 3, required: true },
      { name: 'ticket', description: 'Tracking ticket identifier', type: 3 },
      { name: 'notes', description: 'Additional implementation notes', type: 3 },
    ],
  },
  {
    name: 'review',
    description: 'Collect artefacts for async review and notify approvers.',
    options: [
      { name: 'project', description: 'Project or repository slug', type: 3, required: true },
      { name: 'artifact', description: 'Link or handle to the artefact under review', type: 3, required: true },
      { name: 'notes', description: 'Context or focus areas for reviewers', type: 3 },
      { name: 'deadline', description: 'Review due date (ISO YYYY-MM-DD)', type: 3 },
    ],
  },
]

const discordApiBase = 'https://discord.com/api/v10'

const main = async () => {
  const applicationId = requireEnv('DISCORD_APPLICATION_ID')
  const guildId = requireEnv('DISCORD_GUILD_ID')
  const botToken = requireEnv('DISCORD_BOT_TOKEN')

  const url = `${discordApiBase}/applications/${applicationId}/guilds/${guildId}/commands`
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify(commands),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to register commands (${response.status}): ${text}`)
  }

  const registered = (await response.json()) as SlashCommand[]
  console.log(`Registered ${registered.length} commands: ${registered.map((cmd) => cmd.name).join(', ')}`)
}

main().catch((error) => {
  console.error('Command registration failed:', error)
  process.exitCode = 1
})

import process from 'node:process'
import {
  DISCORD_MESSAGE_LIMIT,
  bootstrapRelay,
  iterableFromStream,
  relayStream,
  type RelayMetadata,
} from '../src/discord'
import type { DiscordConfig } from '../src/discord'

interface ParsedArgs {
  stage?: string
  repository?: string
  issue?: string
  title?: string
  runId?: string
  dryRun: boolean
  timestamp?: string
}

const usage = () => {
  console.log(`Usage: discord-relay [options]

Streams stdin to a Discord channel created for this Codex run.

Options:
  --stage <name>        Stage identifier (e.g. plan, implementation).
  --repo <owner/name>   GitHub repository slug.
  --issue <number>      GitHub issue number.
  --title <text>        Optional display title for the run.
  --run-id <id>         Additional identifier appended to the channel name.
  --timestamp <iso>     ISO timestamp used for deterministic naming.
  --dry-run             Print intended actions without talking to Discord.
  -h, --help            Show this help message.

Environment:
  DISCORD_BOT_TOKEN     Discord bot token with channel management scope.
  DISCORD_GUILD_ID      Discord guild identifier.
  DISCORD_CATEGORY_ID   Optional category to place relay channels under.
`)
}

const parseArgs = (argv: string[]): ParsedArgs => {
  const options: ParsedArgs = { dryRun: false }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (typeof arg === 'undefined') {
      continue
    }

    const requireValue = (flag: string): string => {
      const value = argv[i + 1]
      if (typeof value === 'undefined') {
        console.error(`Option ${flag} requires a value`)
        usage()
        process.exit(1)
      }
      i += 1
      return value
    }

    switch (arg) {
      case '--stage':
        options.stage = requireValue('--stage')
        break
      case '--repo':
        options.repository = requireValue('--repo')
        break
      case '--issue':
        options.issue = requireValue('--issue')
        break
      case '--title':
        options.title = requireValue('--title')
        break
      case '--run-id':
        options.runId = requireValue('--run-id')
        break
      case '--timestamp':
        options.timestamp = requireValue('--timestamp')
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '-h':
      case '--help':
        usage()
        process.exit(0)
        break
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`)
          usage()
          process.exit(1)
        } else {
          console.error(`Unexpected argument: ${arg}`)
          usage()
          process.exit(1)
        }
    }
  }

  return options
}

const main = async () => {
  const argv = process.argv.slice(2)
  const options = parseArgs(argv)
  const dryRun = options.dryRun

  const botToken = process.env.DISCORD_BOT_TOKEN
  const guildId = process.env.DISCORD_GUILD_ID
  const categoryId = process.env.DISCORD_CATEGORY_ID

  if (!dryRun && (!botToken || !guildId)) {
    console.error('Missing Discord configuration: DISCORD_BOT_TOKEN and DISCORD_GUILD_ID are required')
    process.exit(2)
  }

  const config: DiscordConfig = {
    botToken: botToken ?? 'dry-run-token',
    guildId: guildId ?? 'dry-run-guild',
    categoryId: categoryId ?? undefined,
  }

  const createdAt = options.timestamp ? new Date(options.timestamp) : new Date()
  if (Number.isNaN(createdAt.getTime())) {
    console.error(`Invalid timestamp provided: ${options.timestamp}`)
    process.exit(1)
  }

  const metadata: RelayMetadata = {
    repository: options.repository,
    issueNumber: options.issue,
    stage: options.stage ?? 'run',
    runId: options.runId,
    title: options.title,
    createdAt,
  }

  const echo = (line: string) => console.error(line)

  try {
    const relay = await bootstrapRelay(config, metadata, { dryRun, echo })
    echo(`Relay channel ready: #${relay.channelName} (${relay.url ?? 'no-url'})`)
    echo(`Message chunk limit: ${DISCORD_MESSAGE_LIMIT} characters`)
    await relayStream(config, relay, iterableFromStream(process.stdin), { dryRun, echo })
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Unknown error')
    if (error instanceof Error && 'stack' in error && error.stack) {
      console.error(error.stack)
    }
    process.exit(1)
  }
}

await main()

#!/usr/bin/env bun
import process from 'node:process'
import { readFile, stat } from 'node:fs/promises'
import { runCodexSession, pushCodexEventsToLoki } from './lib/codex-runner'
import {
  pathExists,
  randomRunId,
  timestampUtc,
  copyAgentLogIfNeeded,
  buildDiscordRelayCommand,
} from './lib/codex-utils'
import { runCli } from './lib/cli'

interface ImplementationEventPayload {
  prompt?: string
  repository?: string
  issueNumber?: number | string
  issueTitle?: string | null
  base?: string | null
  head?: string | null
  planCommentId?: number | string | null
  planCommentUrl?: string | null
  planCommentBody?: string | null
}

const readEventPayload = async (path: string): Promise<ImplementationEventPayload> => {
  const raw = await readFile(path, 'utf8')
  try {
    return JSON.parse(raw) as ImplementationEventPayload
  } catch (error) {
    throw new Error(
      `Failed to parse event payload at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

const sanitizeNullableString = (value: string | null | undefined) => {
  if (!value || value === 'null') {
    return ''
  }
  return value
}

export const runCodexImplementation = async (eventPath: string) => {
  if (!(await pathExists(eventPath))) {
    throw new Error(`Event payload file not found at '${eventPath}'`)
  }

  const event = await readEventPayload(eventPath)

  const prompt = event.prompt?.trim()
  if (!prompt) {
    throw new Error('Missing Codex prompt in event payload')
  }

  const repository = event.repository?.trim()
  if (!repository) {
    throw new Error('Missing repository metadata in event payload')
  }

  const issueNumberRaw = event.issueNumber
  const issueNumber = issueNumberRaw !== undefined && issueNumberRaw !== null ? String(issueNumberRaw) : ''
  if (!issueNumber) {
    throw new Error('Missing issue number metadata in event payload')
  }

  const worktree = process.env.WORKTREE ?? '/workspace/lab'
  const defaultOutputPath = `${worktree}/.codex-implementation.log`
  const outputPath = process.env.OUTPUT_PATH ?? defaultOutputPath
  const jsonOutputPath = process.env.JSON_OUTPUT_PATH ?? `${worktree}/.codex-implementation-events.jsonl`
  const agentOutputPath = process.env.AGENT_OUTPUT_PATH ?? `${worktree}/.codex-implementation-agent.log`
  const lokiEndpoint =
    process.env.LGTM_LOKI_ENDPOINT ?? 'http://lgtm-loki-gateway.lgtm.svc.cluster.local/loki/api/v1/push'

  const baseBranch = sanitizeNullableString(event.base) || process.env.BASE_BRANCH || 'main'
  const headBranch = sanitizeNullableString(event.head) || process.env.HEAD_BRANCH || ''

  const planCommentId =
    event.planCommentId !== undefined && event.planCommentId !== null ? String(event.planCommentId) : ''
  const planCommentUrl = sanitizeNullableString(event.planCommentUrl)
  const planCommentBody = sanitizeNullableString(event.planCommentBody)
  const issueTitle = sanitizeNullableString(event.issueTitle ?? process.env.ISSUE_TITLE ?? '')

  process.env.CODEX_PROMPT = prompt
  process.env.ISSUE_REPO = repository
  process.env.ISSUE_NUMBER = issueNumber
  process.env.BASE_BRANCH = baseBranch
  process.env.HEAD_BRANCH = headBranch
  process.env.PLAN_COMMENT_ID = planCommentId
  process.env.PLAN_COMMENT_URL = planCommentUrl
  process.env.PLAN_COMMENT_BODY = planCommentBody
  process.env.WORKTREE = worktree
  process.env.OUTPUT_PATH = outputPath
  process.env.ISSUE_TITLE = issueTitle

  process.env.CODEX_STAGE = process.env.CODEX_STAGE ?? 'implementation'
  process.env.RUST_LOG = process.env.RUST_LOG ?? 'codex_core=info,codex_exec=debug'
  process.env.RUST_BACKTRACE = process.env.RUST_BACKTRACE ?? '1'

  const relayScript = process.env.RELAY_SCRIPT ?? 'apps/froussard/scripts/discord-relay.ts'
  const relayTimestamp = timestampUtc()
  const relayRunIdSource =
    process.env.CODEX_RELAY_RUN_ID ?? process.env.ARGO_WORKFLOW_NAME ?? process.env.ARGO_WORKFLOW_UID ?? randomRunId()
  const relayRunId = relayRunIdSource.slice(0, 24).toLowerCase()

  let discordRelayCommand: string[] | undefined
  const discordToken = process.env.DISCORD_BOT_TOKEN ?? ''
  const discordGuild = process.env.DISCORD_GUILD_ID ?? ''
  const discordScriptExists = await pathExists(relayScript)

  if (discordToken && discordGuild && discordScriptExists) {
    const args = [
      '--stage',
      'implementation',
      '--repo',
      repository,
      '--issue',
      issueNumber,
      '--timestamp',
      relayTimestamp,
    ]
    if (relayRunId) {
      args.push('--run-id', relayRunId)
    }
    if (issueTitle) {
      args.push('--title', issueTitle)
    }
    if (process.env.DISCORD_RELAY_DRY_RUN === '1') {
      args.push('--dry-run')
    }
    try {
      discordRelayCommand = await buildDiscordRelayCommand(relayScript, args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Discord relay disabled: ${message}`)
    }
  } else {
    console.error('Discord relay disabled: missing credentials or relay script')
  }

  console.error(`Running Codex implementation for ${repository}#${issueNumber}`)

  await runCodexSession({
    stage: 'implementation',
    prompt,
    outputPath,
    jsonOutputPath,
    agentOutputPath,
    discordRelay: discordRelayCommand
      ? {
          command: discordRelayCommand,
          onError: (error) => console.error(`Discord relay failed: ${error.message}`),
        }
      : undefined,
  })

  await copyAgentLogIfNeeded(outputPath, agentOutputPath)
  await pushCodexEventsToLoki('implementation', jsonOutputPath, lokiEndpoint)

  console.log(`Codex execution logged to ${outputPath}`)
  try {
    const jsonStats = await stat(jsonOutputPath)
    if (jsonStats.size > 0) {
      console.log(`Codex JSON events stored at ${jsonOutputPath}`)
    }
  } catch {
    // ignore missing json log
  }

  return {
    repository,
    issueNumber,
    outputPath,
    jsonOutputPath,
    agentOutputPath,
  }
}

await runCli(import.meta, async () => {
  const eventPath = process.argv[2]
  if (!eventPath) {
    throw new Error('Usage: codex-implement.ts <event-json-path>')
  }
  await runCodexImplementation(eventPath)
})

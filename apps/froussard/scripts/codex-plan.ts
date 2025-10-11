#!/usr/bin/env bun
import process from 'node:process'
import { readFile, stat } from 'node:fs/promises'
import { runCodexSession, pushCodexEventsToLoki } from './lib/codex-runner'
import {
  pathExists,
  parseBoolean,
  randomRunId,
  timestampUtc,
  copyAgentLogIfNeeded,
  buildDiscordRelayCommand,
} from './lib/codex-utils'
import { runCli } from './lib/cli'

const dedent = (value: string) => {
  const normalized = value.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  let minIndent: number | undefined
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    const match = line.match(/^(\s+)/)
    const indent = match ? match[1]!.length : 0
    if (minIndent === undefined || indent < minIndent) {
      minIndent = indent
    }
  }
  if (!minIndent || minIndent === 0) {
    return normalized
  }
  return lines.map((line) => (line.startsWith(' '.repeat(minIndent)) ? line.slice(minIndent) : line)).join('\n')
}

const buildPrompt = ({
  basePrompt,
  issueRepo,
  issueNumber,
  worktree,
  baseBranch,
  postToGitHub,
}: {
  basePrompt: string
  issueRepo?: string
  issueNumber?: string
  worktree: string
  baseBranch: string
  postToGitHub: boolean
}) => {
  const trimmedBase = dedent(basePrompt).trim()
  const shouldPost = postToGitHub && !!issueRepo && !!issueNumber

  if (shouldPost) {
    const addon = [
      'Execution notes (do not restate plan requirements above):',
      `- Work from the existing checkout at ${worktree}, already aligned with origin/${baseBranch}.`,
      '- After generating the plan, write it to PLAN.md.',
      `- Post it with \`gh issue comment --repo ${issueRepo} ${issueNumber} --body-file PLAN.md\`.`,
      '- Echo the final plan (PLAN.md contents) and the GH CLI output to stdout.',
      '- If posting fails, surface the GH error and exit non-zero; otherwise exit 0.',
    ].join('\n')
    return `${trimmedBase}\n\n${addon}`
  }

  const addon = [
    'Execution notes:',
    '- Produce a concise Markdown plan using the template below.',
    '- Sections must appear in this order: Summary, Steps, Validation, Risks, Handoff Notes.',
    '- Keep each section brief and action-focused so humans can follow quickly.',
    '- Echo the final plan to stdout when finished and exit 0.',
    '- Use Markdown headings and bullet points where appropriate.',
    '',
    'Plan template (copy verbatim):',
    '### Summary',
    '### Steps',
    '### Validation',
    '### Risks',
    '### Handoff Notes',
  ].join('\n')

  return `${trimmedBase}\n\n${addon}`
}

export const runCodexPlan = async () => {
  const basePrompt = process.env.CODEX_PROMPT
  if (!basePrompt) {
    throw new Error('CODEX_PROMPT environment variable is required')
  }

  const worktree = process.env.WORKTREE ?? '/workspace/lab'
  const baseBranch = process.env.BASE_BRANCH ?? 'main'
  const sanitizeEnv = (value?: string | null) => (value && value !== 'null' ? value : '')

  const issueRepo = sanitizeEnv(process.env.ISSUE_REPO)
  const issueNumber = sanitizeEnv(process.env.ISSUE_NUMBER)
  const issueTitle = sanitizeEnv(process.env.ISSUE_TITLE)
  const postToGitHub = parseBoolean(process.env.POST_TO_GITHUB, true)

  const defaultOutputPath = process.env.PLAN_OUTPUT_PATH ?? `${worktree}/.codex-plan-output.md`
  const outputPath = process.env.OUTPUT_PATH ?? defaultOutputPath
  const jsonOutputPath = process.env.JSON_OUTPUT_PATH ?? `${worktree}/.codex-plan-events.jsonl`
  const agentOutputPath = process.env.AGENT_OUTPUT_PATH ?? `${worktree}/.codex-plan-agent.log`
  const lokiEndpoint =
    process.env.LGTM_LOKI_ENDPOINT ?? 'http://lgtm-loki-gateway.lgtm.svc.cluster.local/loki/api/v1/push'

  process.env.CODEX_STAGE = process.env.CODEX_STAGE ?? 'planning'
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
  const discordScriptExists = relayScript ? await pathExists(relayScript) : false

  if (discordToken && discordGuild && discordScriptExists) {
    try {
      const args = ['--stage', 'plan']
      if (issueRepo) {
        args.push('--repo', issueRepo)
      }
      if (issueNumber) {
        args.push('--issue', issueNumber)
      }
      args.push('--timestamp', relayTimestamp)
      if (relayRunId) {
        args.push('--run-id', relayRunId)
      }
      if (issueTitle) {
        args.push('--title', issueTitle)
      }
      if (process.env.DISCORD_RELAY_DRY_RUN === '1') {
        args.push('--dry-run')
      }
      discordRelayCommand = await buildDiscordRelayCommand(relayScript, args)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`Discord relay disabled: ${message}`)
    }
  } else {
    console.error('Discord relay disabled: missing credentials or relay script')
  }

  const prompt = buildPrompt({
    basePrompt,
    issueRepo,
    issueNumber,
    worktree,
    baseBranch,
    postToGitHub,
  })

  console.error('Starting Codex planning run')

  await runCodexSession({
    stage: 'planning',
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
  await pushCodexEventsToLoki('planning', jsonOutputPath, lokiEndpoint)

  try {
    const outputStats = await stat(outputPath)
    if (outputStats.size > 0) {
      console.error('Codex plan output:')
      console.error(await readFile(outputPath, 'utf8'))
    }
  } catch {
    // ignore missing output
  }

  console.log(`Codex interaction logged to ${outputPath}`)
  try {
    const jsonStats = await stat(jsonOutputPath)
    if (jsonStats.size > 0) {
      console.log(`Codex JSON events stored at ${jsonOutputPath}`)
    }
  } catch {
    // ignore missing json log
  }

  return {
    outputPath,
    jsonOutputPath,
    agentOutputPath,
  }
}

await runCli(import.meta, runCodexPlan)

#!/usr/bin/env bun
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { runCli } from './lib/cli'
import { pushCodexEventsToLoki, runCodexSession } from './lib/codex-runner'
import {
  buildDiscordRelayCommand,
  copyAgentLogIfNeeded,
  parseBoolean,
  pathExists,
  randomRunId,
  timestampUtc,
} from './lib/codex-utils'
import { createCodexLogger } from './lib/logger'

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
    const indent = match?.[1]?.length ?? 0
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
      '- After generating the plan, write it to PLAN.md and keep the file in place for automation.',
      '- Echo PLAN.md to stdout when finished.',
      '- Do not post to GitHub manually; automation handles comment publication.',
      '- If PLAN.md is missing or empty, exit non-zero.',
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

const postPlanToGitHub = async ({
  planContent,
  issueRepo,
  issueNumber,
}: {
  planContent: string
  issueRepo: string
  issueNumber: string
}) => {
  if (!planContent.trim()) {
    throw new Error('Plan output is empty; cannot post to GitHub')
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'codex-plan-comment-'))
  const planFilePath = join(tempDir, 'PLAN.md')

  try {
    await writeFile(planFilePath, planContent, 'utf8')
    const ghProcess = Bun.spawn({
      cmd: ['gh', 'issue', 'comment', '--repo', issueRepo, issueNumber, '--body-file', planFilePath],
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await ghProcess.exited
    if (exitCode !== 0) {
      throw new Error(`gh issue comment exited with status ${exitCode}`)
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
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
  const shouldPost = postToGitHub && !!issueRepo && !!issueNumber

  const defaultOutputPath = process.env.PLAN_OUTPUT_PATH ?? `${worktree}/.codex-plan-output.md`
  const outputPath = process.env.OUTPUT_PATH ?? defaultOutputPath
  const jsonOutputPath = process.env.JSON_OUTPUT_PATH ?? `${worktree}/.codex-plan-events.jsonl`
  const agentOutputPath = process.env.AGENT_OUTPUT_PATH ?? `${worktree}/.codex-plan-agent.log`
  const runtimeLogPath = process.env.CODEX_RUNTIME_LOG_PATH ?? `${worktree}/.codex-plan-runtime.log`
  const lokiEndpoint =
    process.env.LGTM_LOKI_ENDPOINT ??
    'http://observability-loki-loki-distributed-gateway.observability.svc.cluster.local/loki/api/v1/push'
  const lokiTenant = process.env.LGTM_LOKI_TENANT
  const lokiBasicAuth = process.env.LGTM_LOKI_BASIC_AUTH

  process.env.CODEX_STAGE = process.env.CODEX_STAGE ?? 'planning'
  process.env.RUST_LOG = process.env.RUST_LOG ?? 'codex_core=info,codex_exec=info'
  process.env.RUST_BACKTRACE = process.env.RUST_BACKTRACE ?? '1'

  const relayScript = process.env.RELAY_SCRIPT ?? 'apps/froussard/scripts/discord-relay.ts'
  const relayTimestamp = timestampUtc()
  const relayRunIdSource =
    process.env.CODEX_RELAY_RUN_ID ?? process.env.ARGO_WORKFLOW_NAME ?? process.env.ARGO_WORKFLOW_UID ?? randomRunId()
  const relayRunId = relayRunIdSource.slice(0, 24).toLowerCase()

  const logger = await createCodexLogger({
    logPath: runtimeLogPath,
    context: {
      stage: 'planning',
      repository: issueRepo || undefined,
      issue: issueNumber || undefined,
      workflow: process.env.ARGO_WORKFLOW_NAME ?? undefined,
      namespace: process.env.ARGO_WORKFLOW_NAMESPACE ?? undefined,
      run_id: relayRunId || undefined,
    },
  })

  try {
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
        logger.warn(`Discord relay disabled: ${message}`)
      }
    } else {
      logger.warn('Discord relay disabled: missing credentials or relay script')
    }

    const prompt = buildPrompt({
      basePrompt,
      issueRepo,
      issueNumber,
      worktree,
      baseBranch,
      postToGitHub,
    })

    logger.info('Starting Codex planning run')

    await runCodexSession({
      stage: 'planning',
      prompt,
      outputPath,
      jsonOutputPath,
      agentOutputPath,
      logger,
      discordRelay: discordRelayCommand
        ? {
            command: discordRelayCommand,
            onError: (error) => logger.error(`Discord relay failed: ${error.message}`),
          }
        : undefined,
    })

    await copyAgentLogIfNeeded(outputPath, agentOutputPath)
    await pushCodexEventsToLoki({
      stage: 'planning',
      endpoint: lokiEndpoint,
      jsonPath: jsonOutputPath,
      agentLogPath: agentOutputPath,
      runtimeLogPath,
      labels: {
        repository: issueRepo || undefined,
        issue: issueNumber || undefined,
        workflow: process.env.ARGO_WORKFLOW_NAME ?? undefined,
        namespace: process.env.ARGO_WORKFLOW_NAMESPACE ?? undefined,
        run_id: relayRunId || undefined,
      },
      tenant: lokiTenant,
      basicAuth: lokiBasicAuth,
      logger,
    })

    let planContent = ''

    try {
      const outputStats = await stat(outputPath)
      if (outputStats.size > 0) {
        planContent = await readFile(outputPath, 'utf8')
        logger.info('Codex plan output:')
        logger.info(planContent)
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

    if (shouldPost && planContent.trim()) {
      await postPlanToGitHub({
        planContent,
        issueRepo,
        issueNumber,
      })
    } else if (shouldPost) {
      throw new Error('Plan output missing; skipping GitHub comment')
    }

    return {
      outputPath,
      jsonOutputPath,
      agentOutputPath,
    }
  } finally {
    await logger.flush()
  }
}

await runCli(import.meta, runCodexPlan)

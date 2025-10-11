import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCodexPlan } from '../codex-plan'

const utilMocks = vi.hoisted(() => ({
  pathExists: vi.fn(async () => false),
  parseBoolean: vi.fn((value: string | undefined, fallback: boolean) => {
    if (value === undefined) {
      return fallback
    }
    return ['1', 'true', 'yes'].includes(value.toLowerCase())
  }),
  randomRunId: vi.fn(() => 'random123'),
  timestampUtc: vi.fn(() => '2025-10-11T00:00:00Z'),
  copyAgentLogIfNeeded: vi.fn(async () => undefined),
  buildDiscordRelayCommand: vi.fn(async () => ['bun', 'run', 'relay.ts']),
}))

vi.mock('../lib/codex-utils', () => utilMocks)

const bunUtils = vi.hoisted(() => ({
  which: vi.fn(async () => 'bun') as (command: string) => Promise<string>,
}))

vi.mock('bun', () => bunUtils)

const runnerMocks = vi.hoisted(() => ({
  runCodexSession: vi.fn(async () => ({ agentMessages: [] })),
  pushCodexEventsToLoki: vi.fn(async () => {}),
}))

vi.mock('../lib/codex-runner', () => runnerMocks)

const runCodexSessionMock = runnerMocks.runCodexSession
const pushCodexEventsToLokiMock = runnerMocks.pushCodexEventsToLoki
const buildDiscordRelayCommandMock = utilMocks.buildDiscordRelayCommand

const ORIGINAL_ENV = { ...process.env }

const resetEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value
  }
}

describe('runCodexPlan', () => {
  let workdir: string

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'codex-plan-test-'))
    process.env.WORKTREE = workdir
    process.env.CODEX_PROMPT = '# Plan\n- do things'
    process.env.POST_TO_GITHUB = 'false'
    process.env.LGTM_LOKI_ENDPOINT = 'http://localhost/loki'
    runCodexSessionMock.mockClear()
    pushCodexEventsToLokiMock.mockClear()
    buildDiscordRelayCommandMock.mockClear()
    utilMocks.pathExists.mockResolvedValue(false)
  })

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true })
    resetEnv()
  })

  it('invokes the Codex planning session with derived paths', async () => {
    await runCodexPlan()

    expect(runCodexSessionMock).toHaveBeenCalledTimes(1)
    const invocation = runCodexSessionMock.mock.calls[0]?.[0]
    expect(invocation?.stage).toBe('planning')
    expect(invocation?.outputPath).toBe(join(workdir, '.codex-plan-output.md'))
    expect(invocation?.jsonOutputPath).toBe(join(workdir, '.codex-plan-events.jsonl'))
    expect(invocation?.agentOutputPath).toBe(join(workdir, '.codex-plan-agent.log'))
    expect(pushCodexEventsToLokiMock).toHaveBeenCalledWith(
      'planning',
      join(workdir, '.codex-plan-events.jsonl'),
      'http://localhost/loki',
    )
  })

  it('throws when CODEX_PROMPT is missing', async () => {
    delete process.env.CODEX_PROMPT
    await expect(runCodexPlan()).rejects.toThrow('CODEX_PROMPT environment variable is required')
  })

  it('adds GitHub posting instructions when POST_TO_GITHUB is true', async () => {
    process.env.POST_TO_GITHUB = 'true'
    process.env.ISSUE_REPO = 'owner/repo'
    process.env.ISSUE_NUMBER = '123'

    await runCodexPlan()

    const invocation = runCodexSessionMock.mock.calls[0]?.[0]
    expect(invocation?.prompt).toContain('After generating the plan, write it to PLAN.md')
  })

  it('configures discord relay when a script and credentials are present', async () => {
    process.env.DISCORD_BOT_TOKEN = 'token'
    process.env.DISCORD_GUILD_ID = 'guild'
    process.env.RELAY_SCRIPT = 'apps/froussard/scripts/discord-relay.ts'
    utilMocks.pathExists.mockImplementation(async (path: string) => path.includes('discord-relay.ts'))

    await runCodexPlan()

    expect(buildDiscordRelayCommandMock).toHaveBeenCalledWith(
      'apps/froussard/scripts/discord-relay.ts',
      expect.any(Array),
    )
    const invocation = runCodexSessionMock.mock.calls[0]?.[0]
    expect(invocation?.discordRelay?.command).toEqual(['bun', 'run', 'relay.ts'])
  })
})

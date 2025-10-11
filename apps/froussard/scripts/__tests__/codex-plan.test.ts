import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCodexPlan } from '../codex-plan'

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
})

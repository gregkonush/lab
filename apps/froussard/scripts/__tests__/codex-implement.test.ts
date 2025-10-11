import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCodexImplementation } from '../codex-implement'

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

describe('runCodexImplementation', () => {
  let workdir: string
  let eventPath: string

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'codex-impl-test-'))
    eventPath = join(workdir, 'event.json')
    process.env.WORKTREE = workdir
    process.env.LGTM_LOKI_ENDPOINT = 'http://localhost/loki'
    process.env.RELAY_SCRIPT = ''

    const payload = {
      prompt: 'Implementation prompt',
      repository: 'owner/repo',
      issueNumber: 42,
      base: 'main',
      head: 'codex/issue-42',
      issueTitle: 'Title',
      planCommentId: 123,
      planCommentUrl: 'http://example.com',
      planCommentBody: '<!-- codex:plan -->',
    }
    await writeFile(eventPath, JSON.stringify(payload))

    runCodexSessionMock.mockClear()
    pushCodexEventsToLokiMock.mockClear()
  })

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true })
    resetEnv()
  })

  it('runs the implementation session and pushes events', async () => {
    await runCodexImplementation(eventPath)

    expect(runCodexSessionMock).toHaveBeenCalledTimes(1)
    const invocation = runCodexSessionMock.mock.calls[0]?.[0]
    expect(invocation?.stage).toBe('implementation')
    expect(invocation?.outputPath).toBe(join(workdir, '.codex-implementation.log'))
    expect(pushCodexEventsToLokiMock).toHaveBeenCalledWith(
      'implementation',
      join(workdir, '.codex-implementation-events.jsonl'),
      'http://localhost/loki',
    )
  })

  it('throws when the event file is missing', async () => {
    await expect(runCodexImplementation(join(workdir, 'missing.json'))).rejects.toThrow(/Event payload file not found/)
  })
})

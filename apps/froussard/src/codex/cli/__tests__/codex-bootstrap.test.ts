import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCodexBootstrap } from '../codex-bootstrap'

const bunMocks = vi.hoisted(() => {
  const execMock = vi.fn(async () => ({ text: async () => '' }))
  const spawnMock = vi.fn(() => ({ exited: Promise.resolve(0) }))
  const whichMock = vi.fn(async (command: string) => command)

  const makeTagged =
    (cwd?: string) =>
    async (strings: TemplateStringsArray, ...exprs: unknown[]) => {
      const command = strings.reduce((acc, part, index) => acc + part + (exprs[index] ?? ''), '').trim()
      execMock({ command, cwd })
      return { text: async () => '' }
    }

  const dollar = (...args: unknown[]) => {
    const first = args[0]
    if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, 'raw')) {
      return makeTagged()(first as TemplateStringsArray, ...(args.slice(1) as unknown[]))
    }
    if (typeof first === 'object' && first !== null) {
      const options = first as { cwd?: string }
      return makeTagged(options.cwd)
    }
    throw new Error('Invalid invocation of $ stub')
  }

  return { execMock, spawnMock, whichMock, dollar }
})

vi.mock('bun', () => ({
  $: bunMocks.dollar,
  spawn: bunMocks.spawnMock,
  which: bunMocks.whichMock,
}))

const execMock = bunMocks.execMock
const spawnMock = bunMocks.spawnMock
const whichMock = bunMocks.whichMock

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_CWD = process.cwd()

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

describe('runCodexBootstrap', () => {
  let workdir: string

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'codex-bootstrap-test-'))
    process.env.WORKTREE = workdir
    process.env.TARGET_DIR = workdir
    process.env.BASE_BRANCH = 'main'
    execMock.mockClear()
    spawnMock.mockClear()
    whichMock.mockClear()
  })

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true })
    process.chdir(ORIGINAL_CWD)
    resetEnv()
  })

  it('fetches and resets when the repository already exists', async () => {
    await mkdir(join(workdir, '.git'), { recursive: true })

    const exitCode = await runCodexBootstrap()

    expect(exitCode).toBe(0)
    const commands = execMock.mock.calls.map((call) => call[0]?.command)
    expect(commands).toContain('git fetch --all --prune')
    expect(commands).toContain('git reset --hard origin/main')
  })

  it('runs the requested command and returns its exit code', async () => {
    spawnMock.mockImplementationOnce(() => ({ exited: Promise.resolve(7) }))
    await mkdir(join(workdir, '.git'), { recursive: true })

    const exitCode = await runCodexBootstrap(['ls', '-la'])

    expect(whichMock).toHaveBeenCalledWith('ls')
    expect(spawnMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cmd: ['ls', '-la'],
        cwd: workdir,
      }),
    )
    expect(exitCode).toBe(7)
  })
})

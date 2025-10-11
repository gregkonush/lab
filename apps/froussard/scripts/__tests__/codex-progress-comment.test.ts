import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runCodexProgressComment } from '../codex-progress-comment'

const bunMocks = vi.hoisted(() => {
  const execMock = vi.fn()
  const whichMock = vi.fn(async () => 'gh')
  const makeTagged =
    () =>
    (strings: TemplateStringsArray, ...exprs: unknown[]) => {
      const command = strings.reduce((acc, part, index) => acc + part + (exprs[index] ?? ''), '').trim()
      execMock(command)
      return {
        text: async () =>
          JSON.stringify({
            id: 100,
            html_url: 'https://github.com/owner/repo/comments/100',
            body: '<!-- codex:progress --> body',
          }),
      }
    }
  const dollar = (...args: unknown[]) => {
    const first = args[0]
    if (Array.isArray(first) && Object.prototype.hasOwnProperty.call(first, 'raw')) {
      return makeTagged()(first as TemplateStringsArray, ...(args.slice(1) as unknown[]))
    }
    if (typeof first === 'object' && first !== null) {
      return makeTagged()
    }
    throw new Error('Invalid $ invocation')
  }

  return { execMock, whichMock, dollar }
})

vi.mock('bun', () => ({
  $: bunMocks.dollar,
  which: bunMocks.whichMock,
}))

const execMock = bunMocks.execMock
const whichMock = bunMocks.whichMock

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

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

describe('runCodexProgressComment', () => {
  beforeEach(() => {
    process.env.ISSUE_REPO = 'owner/repo'
    process.env.ISSUE_NUMBER = '42'
    process.env.GH_TOKEN = 'token'
    execMock.mockClear()
    whichMock.mockClear()
  })

  afterEach(() => {
    resetEnv()
    if (ORIGINAL_FETCH) {
      global.fetch = ORIGINAL_FETCH
    }
  })

  it('creates a new comment when none exists', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [],
      text: async () => '[]',
      status: 200,
      statusText: 'OK',
    }))
    global.fetch = fetchMock as unknown as typeof global.fetch

    const result = await runCodexProgressComment({ body: '<!-- codex:progress --> hello' })

    expect(fetchMock).toHaveBeenCalled()
    expect(execMock).toHaveBeenCalledWith(expect.stringContaining('repos/owner/repo/issues/42/comments --method POST'))
    expect(result.action).toBe('create')
    expect(result.commentId).toBe(100)
    expect(result.commentUrl).toBe('https://github.com/owner/repo/comments/100')
    expect(result.markerPresent).toBe(1)
  })

  it('updates an existing comment when the marker is found', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [
        {
          id: 55,
          html_url: 'https://github.com/owner/repo/comments/55',
          body: '<!-- codex:progress --> previous',
        },
      ],
      text: async () => '[]',
      status: 200,
      statusText: 'OK',
    }))
    global.fetch = fetchMock as unknown as typeof global.fetch

    const result = await runCodexProgressComment({ body: '<!-- codex:progress --> update' })

    expect(execMock).toHaveBeenCalledWith(expect.stringContaining('repos/owner/repo/issues/comments/55 --method PATCH'))
    expect(result.action).toBe('update')
    expect(result.commentId).toBe(100)
  })

  it('throws when the marker is missing', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => [],
      text: async () => '[]',
      status: 200,
      statusText: 'OK',
    }))
    global.fetch = fetchMock as unknown as typeof global.fetch

    await expect(runCodexProgressComment({ body: 'no marker' })).rejects.toThrow(
      "Comment body must include the marker '<!-- codex:progress -->'",
    )
  })
})

import { describe, expect, it, vi } from 'vitest'

import { postIssueReaction } from './github'

describe('postIssueReaction', () => {
  it('reports missing token when GITHUB_TOKEN is not configured', async () => {
    const result = await postIssueReaction({
      repositoryFullName: 'owner/repo',
      issueNumber: 12,
      token: null,
      reactionContent: 'rocket',
      fetchImplementation: null,
    })

    expect(result).toEqual({ ok: false, reason: 'missing-token' })
  })

  it('rejects invalid repository names', async () => {
    const result = await postIssueReaction({
      repositoryFullName: 'invalid-owner-only',
      issueNumber: 99,
      token: 'token',
      reactionContent: 'rocket',
      fetchImplementation: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('invalid-repository')
    }
  })

  it('posts reaction payload to the GitHub API', async () => {
    const fetchSpy = vi.fn(async (_input: string, init) => {
      return {
        ok: true,
        status: 201,
        text: async () => '',
      }
    })

    const result = await postIssueReaction({
      repositoryFullName: 'acme/widgets',
      issueNumber: 7,
      token: 'secret-token',
      reactionContent: 'rocket',
      apiBaseUrl: 'https://example.test/api',
      userAgent: 'custom-agent',
      fetchImplementation: fetchSpy,
    })

    expect(result).toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://example.test/api/repos/acme/widgets/issues/7/reactions')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer secret-token',
      'Content-Type': 'application/json',
      'User-Agent': 'custom-agent',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    expect(init?.body).toBe(JSON.stringify({ content: 'rocket' }))
  })

  it('propagates http errors with status and body details', async () => {
    const fetchSpy = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        text: async () => 'forbidden',
      }
    })

    const result = await postIssueReaction({
      repositoryFullName: 'acme/widgets',
      issueNumber: 7,
      token: 'secret-token',
      reactionContent: 'rocket',
      fetchImplementation: fetchSpy,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('http-error')
      expect(result.status).toBe(403)
      expect(result.detail).toBe('forbidden')
    }
  })
})

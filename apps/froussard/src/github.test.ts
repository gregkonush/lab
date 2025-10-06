import { describe, expect, it, vi } from 'vitest'

import { PLAN_COMMENT_MARKER } from './codex'
import { findLatestPlanComment, postIssueReaction } from './github'

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

  it('indicates when no fetch implementation is available', async () => {
    const result = await postIssueReaction({
      repositoryFullName: 'owner/repo',
      issueNumber: 13,
      token: 'token',
      reactionContent: 'heart',
      fetchImplementation: null,
    })

    expect(result).toEqual({ ok: false, reason: 'no-fetch' })
  })

  it('surfaces network errors thrown by the fetch implementation', async () => {
    const result = await postIssueReaction({
      repositoryFullName: 'owner/repo',
      issueNumber: 99,
      token: 'token',
      reactionContent: 'eyes',
      fetchImplementation: async () => {
        throw new Error('boom')
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('network-error')
      expect(result.detail).toBe('boom')
    }
  })

  it('removes trailing slashes from the API base URL before sending the request', async () => {
    const fetchSpy = vi.fn(async (_url: string) => ({
      ok: true,
      status: 201,
      text: async () => '',
    }))

    await postIssueReaction({
      repositoryFullName: 'acme/widgets',
      issueNumber: 5,
      token: 'secret-token',
      reactionContent: 'rocket',
      apiBaseUrl: 'https://example.test/api/',
      fetchImplementation: fetchSpy,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://example.test/api/repos/acme/widgets/issues/5/reactions')
  })
})

describe('findLatestPlanComment', () => {
  it('returns the latest comment containing the plan marker', async () => {
    const payload = [
      { id: 101, body: 'Regular comment' },
      { id: 202, body: `${PLAN_COMMENT_MARKER}\nApproved steps`, html_url: 'https://example.com/comment/202' },
    ]

    const result = await findLatestPlanComment({
      repositoryFullName: 'gregkonush/lab',
      issueNumber: 12,
      fetchImplementation: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.comment.id).toBe(202)
    expect(result.comment.body).toContain('Approved steps')
    expect(result.comment.htmlUrl).toBe('https://example.com/comment/202')
  })

  it('returns not-found when no comment carries the plan marker', async () => {
    const payload = [{ id: 303, body: 'No marker here' }]

    const result = await findLatestPlanComment({
      repositoryFullName: 'gregkonush/lab',
      issueNumber: 99,
      fetchImplementation: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      }),
    })

    expect(result).toEqual({ ok: false, reason: 'not-found' })
  })

  it('rejects repositories without owner and name segments', async () => {
    const result = await findLatestPlanComment({
      repositoryFullName: 'invalid-repo',
      issueNumber: 5,
      fetchImplementation: async () => {
        throw new Error('fetch should not be called')
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.reason).toBe('invalid-repository')
  })
})

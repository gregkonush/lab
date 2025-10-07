import { PLAN_COMMENT_MARKER } from '@/codex'

type FetchInit = {
  method?: string
  headers?: Record<string, string>
  body?: string
}

interface FetchResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

type FetchLike = (input: string, init?: FetchInit) => Promise<FetchResponse>

export interface PostIssueReactionOptions {
  repositoryFullName: string
  issueNumber: number
  token?: string | null
  reactionContent: string
  apiBaseUrl?: string
  userAgent?: string
  fetchImplementation?: FetchLike | null
}

export type PostIssueReactionFailureReason =
  | 'missing-token'
  | 'invalid-repository'
  | 'no-fetch'
  | 'http-error'
  | 'network-error'

export type PostIssueReactionResult =
  | { ok: true }
  | { ok: false; reason: PostIssueReactionFailureReason; status?: number; detail?: string }

const DEFAULT_API_BASE_URL = 'https://api.github.com'
const DEFAULT_USER_AGENT = 'froussard-webhook'

const trimTrailingSlash = (value: string): string => {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

export const postIssueReaction = async (options: PostIssueReactionOptions): Promise<PostIssueReactionResult> => {
  const {
    repositoryFullName,
    issueNumber,
    token,
    reactionContent,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    userAgent = DEFAULT_USER_AGENT,
    fetchImplementation = typeof globalThis.fetch === 'function' ? (globalThis.fetch as FetchLike) : null,
  } = options

  if (!token || token.trim().length === 0) {
    return { ok: false, reason: 'missing-token' }
  }

  const [owner, repo] = repositoryFullName.split('/')
  if (!owner || !repo) {
    return { ok: false, reason: 'invalid-repository', detail: repositoryFullName }
  }

  const fetchFn = fetchImplementation
  if (!fetchFn) {
    return { ok: false, reason: 'no-fetch' }
  }

  const url = `${trimTrailingSlash(apiBaseUrl)}/repos/${owner}/${repo}/issues/${issueNumber}/reactions`

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${token}`,
        'User-Agent': userAgent,
      },
      body: JSON.stringify({ content: reactionContent }),
    })

    if (!response.ok) {
      let detail: string | undefined
      try {
        detail = await response.text()
      } catch (error: unknown) {
        detail = error instanceof Error ? error.message : undefined
      }

      return { ok: false, reason: 'http-error', status: response.status, detail }
    }

    return { ok: true }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return { ok: false, reason: 'network-error', detail }
  }
}

export interface PlanComment {
  id: number
  body: string
  htmlUrl: string | null
}

export interface FindPlanCommentOptions {
  repositoryFullName: string
  issueNumber: number
  token?: string | null
  marker?: string
  apiBaseUrl?: string
  userAgent?: string
  fetchImplementation?: FetchLike | null
}

export type FindPlanCommentFailureReason =
  | 'invalid-repository'
  | 'no-fetch'
  | 'http-error'
  | 'network-error'
  | 'invalid-json'
  | 'not-found'
  | 'invalid-comment'

export type FindPlanCommentResult =
  | { ok: true; comment: PlanComment }
  | { ok: false; reason: FindPlanCommentFailureReason; status?: number; detail?: string }

const coerceNumericId = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

const parseJsonSafely = (text: string): unknown => {
  if (text.length === 0) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error: unknown) {
    throw new Error(error instanceof Error ? error.message : 'Failed to parse JSON response')
  }
}

export const findLatestPlanComment = async (options: FindPlanCommentOptions): Promise<FindPlanCommentResult> => {
  const {
    repositoryFullName,
    issueNumber,
    token,
    marker = PLAN_COMMENT_MARKER,
    apiBaseUrl = DEFAULT_API_BASE_URL,
    userAgent = DEFAULT_USER_AGENT,
    fetchImplementation = typeof globalThis.fetch === 'function' ? (globalThis.fetch as FetchLike) : null,
  } = options

  const [owner, repo] = repositoryFullName.split('/')
  if (!owner || !repo) {
    return { ok: false, reason: 'invalid-repository', detail: repositoryFullName }
  }

  const fetchFn = fetchImplementation
  if (!fetchFn) {
    return { ok: false, reason: 'no-fetch' }
  }

  const url = `${trimTrailingSlash(apiBaseUrl)}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&sort=created&direction=desc`

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': userAgent,
        ...(token && token.trim().length > 0 ? { Authorization: `Bearer ${token}` } : {}),
      },
    })

    if (!response.ok) {
      let detail: string | undefined
      try {
        detail = await response.text()
      } catch (error: unknown) {
        detail = error instanceof Error ? error.message : undefined
      }

      return { ok: false, reason: 'http-error', status: response.status, detail }
    }

    let parsed: unknown
    try {
      parsed = parseJsonSafely(await response.text())
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : undefined
      return { ok: false, reason: 'invalid-json', detail }
    }

    if (!Array.isArray(parsed)) {
      return { ok: false, reason: 'invalid-json', detail: 'Expected array of issue comments' }
    }

    const planComment = parsed.find((comment) => {
      if (!comment || typeof comment !== 'object') {
        return false
      }

      const body = (comment as { body?: unknown }).body
      return typeof body === 'string' && body.includes(marker)
    }) as { id?: unknown; body?: unknown; html_url?: unknown } | undefined

    if (!planComment || typeof planComment.body !== 'string') {
      return { ok: false, reason: 'not-found' }
    }

    const commentId = coerceNumericId(planComment.id)
    if (commentId === null) {
      return { ok: false, reason: 'invalid-comment', detail: 'Missing numeric comment id' }
    }

    const commentBody = planComment.body
    const commentUrl =
      typeof planComment.html_url === 'string' && planComment.html_url.length > 0 ? planComment.html_url : null

    return {
      ok: true,
      comment: {
        id: commentId,
        body: commentBody,
        htmlUrl: commentUrl,
      },
    }
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'Unknown error'
    return { ok: false, reason: 'network-error', detail }
  }
}

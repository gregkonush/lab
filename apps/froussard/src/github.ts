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

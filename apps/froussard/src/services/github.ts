import { Effect, Layer } from 'effect'

import { PLAN_COMMENT_MARKER } from '@/codex'

export interface FetchInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface FetchResponse {
  ok: boolean
  status: number
  text(): Promise<string>
}

export type FetchLike = (input: string, init?: FetchInit) => Promise<FetchResponse>

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

const DEFAULT_API_BASE_URL = 'https://api.github.com'
const DEFAULT_USER_AGENT = 'froussard-webhook'

const trimTrailingSlash = (value: string): string => (value.endsWith('/') ? value.slice(0, -1) : value)

const toError = (error: unknown) => (error instanceof Error ? error : new Error(String(error)))

const readResponseText = (response: FetchResponse) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: toError,
  })

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

export const postIssueReaction = (options: PostIssueReactionOptions): Effect.Effect<PostIssueReactionResult> => {
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
    return Effect.succeed({ ok: false, reason: 'missing-token' } as const)
  }

  const [owner, repo] = repositoryFullName.split('/')
  if (!owner || !repo) {
    return Effect.succeed({
      ok: false,
      reason: 'invalid-repository' as const,
      detail: repositoryFullName,
    })
  }

  const fetchFn = fetchImplementation
  if (!fetchFn) {
    return Effect.succeed({ ok: false, reason: 'no-fetch' } as const)
  }

  const url = `${trimTrailingSlash(apiBaseUrl)}/repos/${owner}/${repo}/issues/${issueNumber}/reactions`

  return Effect.tryPromise({
    try: () =>
      fetchFn(url, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          Authorization: `Bearer ${token}`,
          'User-Agent': userAgent,
        },
        body: JSON.stringify({ content: reactionContent }),
      }),
    catch: toError,
  }).pipe(
    Effect.flatMap((response) => {
      if (response.ok) {
        return Effect.succeed<PostIssueReactionResult>({ ok: true })
      }

      return readResponseText(response)
        .pipe(Effect.catchAll(() => Effect.succeed<string | undefined>(undefined)))
        .pipe(
          Effect.map((detail) => ({
            ok: false as const,
            reason: 'http-error' as const,
            status: response.status,
            detail,
          })),
        )
    }),
    Effect.catchAll((error) =>
      Effect.succeed<PostIssueReactionResult>({
        ok: false,
        reason: 'network-error',
        detail: error instanceof Error ? error.message : String(error),
      }),
    ),
  )
}

export const findLatestPlanComment = (options: FindPlanCommentOptions): Effect.Effect<FindPlanCommentResult> => {
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
    return Effect.succeed({
      ok: false,
      reason: 'invalid-repository' as const,
      detail: repositoryFullName,
    })
  }

  const fetchFn = fetchImplementation
  if (!fetchFn) {
    return Effect.succeed({ ok: false, reason: 'no-fetch' } as const)
  }

  const url = `${trimTrailingSlash(apiBaseUrl)}/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&sort=created&direction=desc`

  return Effect.matchEffect(
    Effect.tryPromise({
      try: () =>
        fetchFn(url, {
          method: 'GET',
          headers: {
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': userAgent,
            ...(token && token.trim().length > 0 ? { Authorization: `Bearer ${token}` } : {}),
          },
        }),
      catch: toError,
    }),
    {
      onFailure: (error) =>
        Effect.succeed<FindPlanCommentResult>({
          ok: false,
          reason: 'network-error',
          detail: error instanceof Error ? error.message : String(error),
        }),
      onSuccess: (response) =>
        Effect.gen(function* (_) {
          if (!response.ok) {
            const detail = yield* readResponseText(response).pipe(
              Effect.catchAll(() => Effect.succeed<string | undefined>(undefined)),
            )
            return {
              ok: false as const,
              reason: 'http-error',
              status: response.status,
              detail,
            }
          }

          const bodyResult = yield* readResponseText(response).pipe(Effect.either)
          if (bodyResult._tag === 'Left') {
            return {
              ok: false as const,
              reason: 'network-error',
              detail: bodyResult.left.message,
            }
          }

          let parsed: unknown
          try {
            parsed = bodyResult.right.length === 0 ? [] : JSON.parse(bodyResult.right)
          } catch (error) {
            return {
              ok: false as const,
              reason: 'invalid-json',
              detail: error instanceof Error ? error.message : String(error),
            }
          }

          if (!Array.isArray(parsed)) {
            return {
              ok: false as const,
              reason: 'invalid-json',
              detail: 'Expected array response from GitHub API',
            }
          }

          for (const comment of parsed) {
            if (!comment || typeof comment !== 'object') {
              continue
            }

            const body = (comment as { body?: unknown }).body
            if (typeof body !== 'string' || !body.includes(marker)) {
              continue
            }

            const id = coerceNumericId((comment as { id?: unknown }).id)
            if (id === null) {
              return {
                ok: false as const,
                reason: 'invalid-comment',
                detail: 'Comment missing numeric id',
              }
            }

            const htmlUrlValue = (comment as { html_url?: unknown }).html_url
            const htmlUrl = typeof htmlUrlValue === 'string' ? htmlUrlValue : null

            return {
              ok: true as const,
              comment: {
                id,
                body,
                htmlUrl,
              },
            }
          }

          return { ok: false as const, reason: 'not-found' }
        }),
    },
  )
}

export interface GithubServiceDefinition {
  readonly postIssueReaction: (options: PostIssueReactionOptions) => Effect.Effect<PostIssueReactionResult>
  readonly findLatestPlanComment: (options: FindPlanCommentOptions) => Effect.Effect<FindPlanCommentResult>
}

export class GithubService extends Effect.Tag('@froussard/GithubService')<GithubService, GithubServiceDefinition>() {}

export const GithubServiceLayer = Layer.sync(GithubService, () => ({
  postIssueReaction,
  findLatestPlanComment,
}))

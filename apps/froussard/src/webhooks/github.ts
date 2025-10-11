import type { Webhooks } from '@octokit/webhooks'
import { randomUUID } from 'node:crypto'

import { Effect } from 'effect'

import { buildCodexBranchName, buildCodexPrompt, normalizeLogin, type CodexTaskMessage } from '@/codex'
import { selectReactionRepository } from '@/codex-workflow'
import { deriveRepositoryFullName, isGithubIssueCommentEvent, isGithubIssueEvent } from '@/github-payload'
import { logger } from '@/logger'
import type { AppRuntime } from '@/effect/runtime'
import { GithubService } from '@/services/github'

import type { WebhookConfig } from './types'
import { publishKafkaMessage } from './utils'

export interface GithubWebhookDependencies {
  runtime: AppRuntime
  webhooks: Webhooks
  config: WebhookConfig
}

export const createGithubWebhookHandler =
  ({ runtime, webhooks, config }: GithubWebhookDependencies) =>
  async (rawBody: string, request: Request): Promise<Response> => {
    const signatureHeader = request.headers.get('x-hub-signature-256')
    if (!signatureHeader) {
      logger.error({ headers: Array.from(request.headers.keys()) }, 'missing x-hub-signature-256 header')
      return new Response('Unauthorized', { status: 401 })
    }

    const deliveryId = request.headers.get('x-github-delivery') || randomUUID()

    if (!(await webhooks.verify(rawBody, signatureHeader))) {
      logger.error({ deliveryId, signatureHeader }, 'github webhook signature verification failed')
      return new Response('Unauthorized', { status: 401 })
    }

    const githubService = runtime.runSync(
      Effect.gen(function* (_) {
        return yield* GithubService
      }),
    )

    let parsedPayload: unknown
    try {
      parsedPayload = JSON.parse(rawBody) as unknown
    } catch (parseError) {
      logger.error({ err: parseError }, 'failed to parse github webhook payload')
      return new Response('Invalid JSON body', { status: 400 })
    }

    const eventName = request.headers.get('x-github-event') ?? 'unknown'
    const hookId = request.headers.get('x-github-hook-id') ?? 'unknown'
    const contentType = request.headers.get('content-type') ?? 'application/json'
    const actionValue =
      typeof (parsedPayload as { action?: unknown }).action === 'string'
        ? (parsedPayload as { action: string }).action
        : undefined

    const headers: Record<string, string> = {
      'x-github-delivery': deliveryId,
      'x-github-event': eventName,
      'x-github-hook-id': hookId,
      'content-type': contentType,
    }
    if (actionValue) {
      headers['x-github-action'] = actionValue
    }

    let codexStageTriggered: string | null = null

    try {
      if (eventName === 'issues' && actionValue === 'opened' && isGithubIssueEvent(parsedPayload)) {
        const issue = parsedPayload.issue
        const repository = parsedPayload.repository
        const senderLoginValue = parsedPayload.sender?.login
        const issueNumber = issue?.number

        if (typeof issueNumber === 'number') {
          const issueAuthor = normalizeLogin(issue?.user?.login)

          if (issueAuthor === config.codexTriggerLogin) {
            const repositoryFullName = deriveRepositoryFullName(repository, issue?.repository_url)
            if (repositoryFullName) {
              const baseBranch = repository?.default_branch ?? config.codebase.baseBranch
              const headBranch = buildCodexBranchName(issueNumber, deliveryId, config.codebase.branchPrefix)
              const issueTitle =
                typeof issue?.title === 'string' && issue.title.length > 0 ? issue.title : `Issue #${issueNumber}`
              const issueBody = typeof issue?.body === 'string' ? issue.body : ''
              const issueUrl = typeof issue?.html_url === 'string' ? issue.html_url : ''
              const prompt = buildCodexPrompt({
                stage: 'planning',
                issueTitle,
                issueBody,
                repositoryFullName,
                issueNumber,
                baseBranch,
                headBranch,
                issueUrl,
              })

              const codexMessage: CodexTaskMessage = {
                stage: 'planning',
                prompt,
                repository: repositoryFullName,
                base: baseBranch,
                head: headBranch,
                issueNumber,
                issueUrl,
                issueTitle,
                issueBody,
                sender: typeof senderLoginValue === 'string' ? senderLoginValue : '',
                issuedAt: new Date().toISOString(),
              }

              await runtime.runPromise(
                publishKafkaMessage({
                  topic: config.topics.codex,
                  key: `issue-${issueNumber}-planning`,
                  value: JSON.stringify(codexMessage),
                  headers: { ...headers, 'x-codex-task-stage': 'planning' },
                }),
              )

              codexStageTriggered = 'planning'

              const reactionResult = await runtime.runPromise(
                githubService.postIssueReaction({
                  repositoryFullName,
                  issueNumber,
                  token: config.github.token,
                  reactionContent: config.github.ackReaction,
                  apiBaseUrl: config.github.apiBaseUrl,
                  userAgent: config.github.userAgent,
                }),
              )

              if (reactionResult.ok) {
                logger.info(
                  {
                    repository: repositoryFullName,
                    issueNumber,
                    deliveryId,
                    reaction: config.github.ackReaction,
                  },
                  'acknowledged github issue',
                )
              }
            }
          }
        }
      }

      if (eventName === 'issue_comment' && actionValue === 'created' && isGithubIssueCommentEvent(parsedPayload)) {
        const commentBody = typeof parsedPayload.comment?.body === 'string' ? parsedPayload.comment.body.trim() : ''
        const senderLoginValue = parsedPayload.sender?.login

        if (
          commentBody === config.codexImplementationTriggerPhrase &&
          normalizeLogin(senderLoginValue) === config.codexTriggerLogin
        ) {
          const issue = parsedPayload.issue
          const issueRepository = selectReactionRepository(issue, parsedPayload.repository)
          const repositoryFullName = deriveRepositoryFullName(issueRepository, issue?.repository_url)
          const issueNumber = typeof issue?.number === 'number' ? issue.number : undefined

          if (issueNumber && repositoryFullName) {
            const baseBranch = issueRepository?.default_branch ?? config.codebase.baseBranch
            const headBranch = buildCodexBranchName(issueNumber, deliveryId, config.codebase.branchPrefix)
            const issueTitle =
              typeof issue?.title === 'string' && issue.title.length > 0 ? issue.title : `Issue #${issueNumber}`
            const issueBody = typeof issue?.body === 'string' ? issue.body : ''
            const issueUrl = typeof issue?.html_url === 'string' ? issue.html_url : ''

            let planCommentBody: string | undefined
            let planCommentId: number | undefined
            let planCommentUrl: string | undefined

            const planLookup = await runtime.runPromise(
              githubService.findLatestPlanComment({
                repositoryFullName,
                issueNumber,
                token: config.github.token,
                apiBaseUrl: config.github.apiBaseUrl,
                userAgent: config.github.userAgent,
              }),
            )

            if (planLookup.ok) {
              planCommentBody = planLookup.comment.body
              planCommentId = planLookup.comment.id
              planCommentUrl = planLookup.comment.htmlUrl ?? undefined
            }

            const prompt = buildCodexPrompt({
              stage: 'implementation',
              issueTitle,
              issueBody,
              repositoryFullName,
              issueNumber,
              baseBranch,
              headBranch,
              issueUrl,
              planCommentBody,
            })

            const codexMessage: CodexTaskMessage = {
              stage: 'implementation',
              prompt,
              repository: repositoryFullName,
              base: baseBranch,
              head: headBranch,
              issueNumber,
              issueUrl,
              issueTitle,
              issueBody,
              sender: typeof senderLoginValue === 'string' ? senderLoginValue : '',
              issuedAt: new Date().toISOString(),
              planCommentBody,
              planCommentId,
              planCommentUrl,
            }

            await runtime.runPromise(
              publishKafkaMessage({
                topic: config.topics.codex,
                key: `issue-${issueNumber}-implementation`,
                value: JSON.stringify(codexMessage),
                headers: { ...headers, 'x-codex-task-stage': 'implementation' },
              }),
            )

            codexStageTriggered = 'implementation'
          }
        }
      }

      await runtime.runPromise(
        publishKafkaMessage({
          topic: config.topics.raw,
          key: deliveryId,
          value: rawBody,
          headers,
        }),
      )

      return new Response(
        JSON.stringify({
          status: 'accepted',
          deliveryId,
          event: eventName,
          action: actionValue ?? null,
          codexStageTriggered,
        }),
        {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    } catch (error) {
      logger.error({ err: error, deliveryId, eventName }, 'failed to enqueue github webhook event')
      return new Response('Failed to enqueue webhook event', { status: 500 })
    }
  }

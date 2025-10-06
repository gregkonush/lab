import { randomUUID } from 'node:crypto'

export type Nullable<T> = T | null | undefined

export type CodexTaskStage = 'planning' | 'implementation'

export const PLAN_COMMENT_MARKER = '<!-- codex:plan -->'

export const normalizeLogin = (login?: Nullable<string>): string | null => {
  if (typeof login === 'string' && login.trim().length > 0) {
    return login.trim().toLowerCase()
  }
  return null
}

export const sanitizeBranchComponent = (value: string): string => {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'task'
  )
}

export const buildCodexBranchName = (issueNumber: number, deliveryId: string, branchPrefix: string): string => {
  const sanitizedPrefix = branchPrefix
  const suffix = sanitizeBranchComponent(deliveryId).slice(0, 8) || randomUUID().slice(0, 8)
  return `${sanitizedPrefix}${issueNumber}-${suffix}`
}

export interface BuildCodexPromptOptions {
  stage: CodexTaskStage
  issueTitle: string
  issueBody: string
  repositoryFullName: string
  issueNumber: number
  baseBranch: string
  headBranch: string
  issueUrl: string
  planCommentBody?: string
}

const fallbackBody = 'No description provided.'

const buildPlanningPrompt = ({
  issueTitle,
  issueBody,
  repositoryFullName,
  issueNumber,
  baseBranch,
  headBranch,
  issueUrl,
}: BuildCodexPromptOptions): string => {
  const trimmedBody = issueBody.trim() || fallbackBody

  return [
    'Plan for the next Codex automation run. Keep it concise, specific, and executable.',
    `Repository: ${repositoryFullName}`,
    `Issue: #${issueNumber} – ${issueTitle}`,
    `Issue URL: ${issueUrl}`,
    `Base branch: ${baseBranch}`,
    `Suggested feature branch: ${headBranch}`,
    '',
    'Review relevant code and tests, then manage the issue reactions and comment lifecycle this way:',
    '1. Immediately add :eyes: to the issue (replace an existing :+1: if present) before doing anything else.',
    '2. Immediately post (or update) a single comment that reads `_Planning in progress…_` to signal work in progress.',
    '3. When the plan is ready, edit that same comment to contain exactly:',
    `${PLAN_COMMENT_MARKER}`,
    '### Summary - key bullets on the user problem and desired outcome.',
    '### Proposed Work - numbered steps with files/modules, rationale, and needed collaborators.',
    '### Validation - required automation, manual QA, observability, rollout tasks.',
    '### Risks & Questions - blockers, assumptions, migrations, sequencing concerns.',
    '### Automation Handoff Notes - env vars, credentials, long jobs, temp assets to prepare.',
    '### Maintainer Checklist - 3-4 checkboxes ending with “React with 👍 when this plan looks good.”',
    '',
    'Do not perform implementation steps; the follow-up run will execute the plan.',
    'After editing the comment, swap :eyes: for :rocket: to signal the plan is ready.',
    '',
    'Issue body for context:',
    '"""',
    trimmedBody,
    '"""',
  ].join('\n')
}

const buildImplementationPrompt = ({
  issueTitle,
  issueBody,
  repositoryFullName,
  issueNumber,
  baseBranch,
  headBranch,
  issueUrl,
  planCommentBody,
}: BuildCodexPromptOptions): string => {
  const trimmedBody = issueBody.trim() || fallbackBody
  const sanitizedPlanBody = (planCommentBody ?? '').trim() || 'No approved plan content was provided.'

  return [
    'Execute the approved plan end to end. Stay concise and surface deviations with reasons.',
    `Repository: ${repositoryFullName}`,
    `Issue: #${issueNumber} – ${issueTitle}`,
    `Issue URL: ${issueUrl}`,
    `Base branch: ${baseBranch}`,
    `Implementation branch: ${headBranch}`,
    '',
    'Approved plan:',
    '"""',
    sanitizedPlanBody,
    '"""',
    '',
    'Execution checklist:',
    '- Work in the existing checkout; keep commits small and reference the issue.',
    `- Create or update the \`${headBranch}\` branch from \`${baseBranch}\`.`,
    '- Follow the plan step by step, noting context for any adjustments.',
    '- Run formatters, lint, tests, and record outputs or failures.',
    `- Open a draft pull request targeting \`${baseBranch}\` that summarises the work, validation, and references "Closes #${issueNumber}" to auto-close the issue on merge.`,
    '- Comment on the issue with the PR link, highlights, and remaining follow-ups.',
    '',
    'Risk management:',
    '- Call out blockers or new risks with mitigation ideas.',
    '- Note manual QA or deployment actions owners must schedule.',
    '',
    'Issue body for quick reference:',
    '"""',
    trimmedBody,
    '"""',
  ].join('\n')
}

export const buildCodexPrompt = (options: BuildCodexPromptOptions): string => {
  if (options.stage === 'planning') {
    return buildPlanningPrompt(options)
  }

  return buildImplementationPrompt(options)
}

export interface CodexTaskMessage {
  stage: CodexTaskStage
  prompt: string
  repository: string
  base: string
  head: string
  issueNumber: number
  issueUrl: string
  issueTitle: string
  issueBody: string
  sender: string
  issuedAt: string
  planCommentId?: number
  planCommentUrl?: string
  planCommentBody?: string
}

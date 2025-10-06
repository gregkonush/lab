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
    '### Planning Workflow',
    '1. Take a deliberate breath, review relevant code/tests, and jot bullet notes on constraints before writing the plan.',
    '2. Immediately add :eyes: to the issue itself (replace an existing :+1: on the issue if present) before doing anything else.',
    '3. Immediately post (or update) a single comment that reads `_Planning in progress…_` to signal work in progress.',
    '4. When the plan is ready, replace `_Planning in progress…_` with the finalized content below.',
    '',
    '### Plan Format',
    'Produce a single GitHub comment exactly in this structure:',
    `${PLAN_COMMENT_MARKER}`,
    '### Summary - key bullets on the user problem and desired outcome.',
    '### Proposed Work - numbered steps with files/modules, rationale, and needed collaborators.',
    '### Validation - required automation, manual QA, observability, rollout tasks.',
    '### Risks & Questions - blockers, assumptions, migrations, sequencing concerns.',
    '### Automation Handoff Notes - env vars, credentials, long jobs, temp assets to prepare.',
    '',
    '### Final Steps',
    'Do not perform implementation steps; the follow-up run executes the plan.',
    'After publishing the plan, swap the issue reaction from :eyes: to :rocket: to signal completeness.',
    'Reply to the issue with the exact phrase `execute plan` when you want automation to start implementation.',
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

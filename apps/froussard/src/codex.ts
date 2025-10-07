import { randomUUID } from 'node:crypto'

export type Nullable<T> = T | null | undefined

export type CodexTaskStage = 'planning' | 'implementation' | 'one-shot'

export const PLAN_COMMENT_MARKER = '<!-- codex:plan -->'
export const PROGRESS_COMMENT_MARKER = '<!-- codex:progress -->'
export const ONE_SHOT_PLAN_PLACEHOLDER = '{{CODEX_ONE_SHOT_PLAN_BODY}}'

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

type CodexSequentialStage = 'planning' | 'implementation'

export interface BuildCodexPromptOptions {
  stage: CodexSequentialStage
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
    'Draft the plan the next Codex run will execute. Reply with the Markdown template below—no extra commentary.',
    `Repository: ${repositoryFullName}`,
    `Issue: #${issueNumber} – ${issueTitle}`,
    `Issue URL: ${issueUrl}`,
    `Base branch: ${baseBranch}`,
    `Proposed feature branch: ${headBranch}`,
    '',
    'Planning checklist:',
    '- React to the issue with :eyes: while drafting; switch to :rocket: once the final comment is posted.',
    '- Post or update a `_Planning in progress…_` comment and replace it with the completed plan.',
    '- Focus on actionable steps the implementation run can carry out without interpretation.',
    '',
    'Plan template (copy verbatim):',
    `${PLAN_COMMENT_MARKER}`,
    '### Summary',
    '### Steps',
    '### Validation',
    '### Risks',
    '### Handoff Notes',
    '',
    'Guidance: describe concrete files, commands, or checks; note why each step matters. Keep the plan short so the executor can scan it quickly.',
    '',
    'Issue context:',
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
    'Execute the approved plan end to end. Keep notes concise and call out any deviations with their rationale.',
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
    'Execution requirements:',
    '- Follow the plan in order; if you must adjust, note what changed and why.',
    `- Maintain a single progress comment anchored by ${PROGRESS_COMMENT_MARKER} using apps/froussard/scripts/codex-progress-comment.sh (kickoff checklist, milestone updates, final summary).`,
    `- Work on \`${headBranch}\` (branched from \`${baseBranch}\`); keep commits focused and reference #${issueNumber}.`,
    '- Run formatters, lint, and tests; record their outputs or failures in the progress comment.',
    `- Open a draft pull request targeting \`${baseBranch}\` with a summary, validation results, and "Closes #${issueNumber}".`,
    '- Comment on the issue with the PR link and any outstanding follow-ups.',
    '- Surface blockers promptly with mitigation ideas and capture required manual QA.',
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

export interface BuildCodexOneShotPromptOptions extends Omit<BuildCodexPromptOptions, 'stage' | 'planCommentBody'> {
  planPlaceholder?: string
}

export interface CodexOneShotPrompts {
  planningPrompt: string
  implementationPrompt: string
  planPlaceholder: string
}

export const buildCodexOneShotPrompts = ({
  planPlaceholder = ONE_SHOT_PLAN_PLACEHOLDER,
  ...options
}: BuildCodexOneShotPromptOptions): CodexOneShotPrompts => {
  const planningPrompt = buildPlanningPrompt({
    ...options,
    stage: 'planning',
  })

  const implementationPrompt = buildImplementationPrompt({
    ...options,
    stage: 'implementation',
    planCommentBody: planPlaceholder,
  })

  return {
    planningPrompt,
    implementationPrompt,
    planPlaceholder,
  }
}

export interface CodexTaskMessage {
  stage: CodexTaskStage
  prompt?: string
  planningPrompt?: string
  implementationPrompt?: string
  planPlaceholder?: string
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

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

export const buildCodexPrompt = ({
  stage,
  issueTitle,
  issueBody,
  repositoryFullName,
  issueNumber,
  baseBranch,
  headBranch,
  issueUrl,
  planCommentBody,
}: BuildCodexPromptOptions): string => {
  const trimmedBody = issueBody.trim() || 'No description provided.'

  if (stage === 'planning') {
    return [
      'Act as a technical fellow-level software engineer and drive the effort end to end.',
      `Repository: ${repositoryFullName}`,
      `Issue: #${issueNumber} – ${issueTitle}`,
      `Issue URL: ${issueUrl}`,
      '',
      'Scope:',
      '- Produce a high-agency execution plan that a senior engineer could hand to an implementation team.',
      '- Do not edit source files or open pull requests in this stage.',
      '',
      'Plan requirements:',
      '1. Begin the GitHub issue comment with the marker `' +
        PLAN_COMMENT_MARKER +
        '` on its own line so automation can detect approval reactions.',
      '2. Provide a concise summary of the customer/user problem in 1–2 sentences.',
      '3. Outline the implementation strategy as a numbered list where each step includes the files or subsystems you expect to touch.',
      '4. Call out validation and testing strategy (automated + manual) and any deployment or observability follow-up.',
      '5. Note risks, open questions, and decisions that require review.',
      '6. Close the comment with a short checklist for maintainers and instruct them to react with 👍 once they approve the plan.',
      '',
      'Context from the issue body:',
      '"""',
      trimmedBody,
      '"""',
      '',
      'Deliverable: post the plan as a GitHub issue comment and stop. Wait for a 👍 reaction from a maintainer before proceeding to implementation.',
    ].join('\n')
  }

  const sanitizedPlanBody = (planCommentBody ?? '').trim() || 'No approved plan content was provided.'

  return [
    'Act as a technical fellow-level software engineer and drive the effort end to end.',
    `Repository: ${repositoryFullName}`,
    `Issue: #${issueNumber} – ${issueTitle}`,
    `Issue URL: ${issueUrl}`,
    '',
    'An approved implementation plan (produced earlier and marked with `' +
      PLAN_COMMENT_MARKER +
      '`) is provided below. Execute it faithfully, adjusting only when you uncover new information. If you must diverge, document why.',
    'Approved plan:',
    '"""',
    sanitizedPlanBody,
    '"""',
    '',
    'Implementation requirements:',
    '- Create or reuse a feature branch named `' + headBranch + '` based on `' + baseBranch + '`.',
    '- Make the required code changes, keeping commits small and referencing the issue number.',
    '- Run formatters, linters, and automated tests relevant to the touched areas; capture their results.',
    '- Open a draft pull request targeting `' +
      baseBranch +
      '` with a summary, testing notes, and link back to the issue.',
    '- Post a follow-up comment on the issue summarizing what changed and link to the draft PR.',
    '',
    'Quality guardrails:',
    '- Highlight any risks or follow-up work that remains.',
    '- Note additional validation or deployment steps for reviewers.',
  ].join('\n')
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

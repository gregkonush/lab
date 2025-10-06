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
      'You are GPT-5 Codex acting as the planning lead for this GitHub issue.',
      'Output only the GitHub issue comment—no intro or trailing narration.',
      `Repository: ${repositoryFullName}`,
      `Issue: #${issueNumber} – ${issueTitle}`,
      `Issue URL: ${issueUrl}`,
      `Base branch: ${baseBranch}`,
      `Proposed feature branch: ${headBranch}`,
      '',
      'Before drafting the plan:',
      '- Replace the existing :+1: reaction on this issue with :eyes: to signal the plan is in progress. If :+1: is absent, just add :eyes:.',
      "- Immediately post (or update) a temporary issue comment that reads `_Planning in progress…_`. Do not include '" +
        PLAN_COMMENT_MARKER +
        '` yet; you will edit this same comment once the plan is ready.',
      '',
      'When the plan is ready, edit that in-progress comment so it matches the structure below.',
      '',
      'Respond with Markdown using this exact structure:',
      '1. ' + PLAN_COMMENT_MARKER,
      '2. `### Summary` — 1–2 bullets describing the user problem and desired outcome.',
      '3. `### Proposed Work` — numbered steps (3–7). Each step must name the key files, services, or schemas to touch and the change to make.',
      '4. `### Validation` — bullets covering automated checks, manual QA, and monitoring/observability updates.',
      '5. `### Risks & Questions` — bullets for blockers, assumptions to confirm, or dependencies.',
      '6. `### Maintainer Checklist` — 3–4 checkboxes summarising what reviewers must confirm; end with “React with 👍 when this plan looks good.”',
      '',
      'Guidelines:',
      '- Stay in planning mode only—no code edits, PR steps, or mentions of future automation.',
      '- Keep sentences concise, call out sequencing, and surface any external dependencies.',
      '- Flag missing information and the follow-up required to obtain it.',
      '- After publishing the final comment, replace the :eyes: reaction with :rocket: to signal completion.',
      '',
      'Issue body for context:',
      '"""',
      trimmedBody,
      '"""',
      '',
      'You have access to the full repository checkout; inspect code and tests as needed before proposing the plan.',
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

import { describe, expect, it } from 'vitest'

import {
  PLAN_COMMENT_MARKER,
  PROGRESS_COMMENT_MARKER,
  buildCodexOneShotPrompts,
  buildCodexBranchName,
  buildCodexPrompt,
  ONE_SHOT_PLAN_PLACEHOLDER,
  normalizeLogin,
  sanitizeBranchComponent,
} from './codex'

describe('normalizeLogin', () => {
  it('lowercases and trims valid logins', () => {
    expect(normalizeLogin('  GregKonush  ')).toBe('gregkonush')
  })

  it('returns null for empty or non-string inputs', () => {
    expect(normalizeLogin('')).toBeNull()
    expect(normalizeLogin(undefined)).toBeNull()
    expect(normalizeLogin(null)).toBeNull()
  })
})

describe('sanitizeBranchComponent', () => {
  it('replaces invalid characters and lowercases the value', () => {
    expect(sanitizeBranchComponent('Feature/ISSUE-123')).toBe('feature-issue-123')
  })

  it('falls back to task when no characters survive sanitisation', () => {
    expect(sanitizeBranchComponent('@@@')).toBe('task')
  })
})

describe('buildCodexBranchName', () => {
  it('builds a deterministic branch prefix with sanitized delivery id suffix', () => {
    const branch = buildCodexBranchName(42, 'Delivery-123XYZ', 'codex/issue-')
    const expectedSuffix = sanitizeBranchComponent('Delivery-123XYZ').slice(0, 8)
    expect(branch.startsWith('codex/issue-42-')).toBe(true)
    expect(branch).toContain(expectedSuffix)
    expect(branch).toMatch(/^codex\/issue-42-[a-z0-9-]+$/)
  })
})

describe('buildCodexPrompt', () => {
  it('constructs a planning prompt with trimmed issue body', () => {
    const prompt = buildCodexPrompt({
      stage: 'planning',
      issueTitle: 'Improve webhook reliability',
      issueBody: '\nFocus on retry logic and logging.  \n',
      repositoryFullName: 'gregkonush/lab',
      issueNumber: 77,
      baseBranch: 'main',
      headBranch: 'codex/issue-77-abc123',
      issueUrl: 'https://github.com/gregkonush/lab/issues/77',
    })

    expect(prompt).toContain('Draft the plan the next Codex run will execute.')
    expect(prompt).toContain('Planning checklist:')
    expect(prompt).toContain(
      'React to the issue with :eyes: while drafting; switch to :rocket: once the final comment is posted.',
    )
    expect(prompt).toContain('Plan template (copy verbatim):')
    expect(prompt).toContain(PLAN_COMMENT_MARKER)
    expect(prompt).toContain('### Steps')
    expect(prompt).toContain('### Handoff Notes')
    expect(prompt).toContain('Guidance: describe concrete files, commands, or checks; note why each step matters.')
    expect(prompt).toContain('"""\nFocus on retry logic and logging.\n"""')
  })

  it('constructs an implementation prompt that embeds the approved plan', () => {
    const prompt = buildCodexPrompt({
      stage: 'implementation',
      issueTitle: 'Improve webhook reliability',
      issueBody: 'Focus on retry logic and logging.',
      repositoryFullName: 'gregkonush/lab',
      issueNumber: 77,
      baseBranch: 'main',
      headBranch: 'codex/issue-77-abc123',
      issueUrl: 'https://github.com/gregkonush/lab/issues/77',
      planCommentBody: `${PLAN_COMMENT_MARKER}\n1. Step one`,
    })

    expect(prompt).toContain(
      'Execute the approved plan end to end. Keep notes concise and call out any deviations with their rationale.',
    )
    expect(prompt).toContain('Approved plan:')
    expect(prompt).toContain('1. Step one')
    expect(prompt).toContain('Implementation branch: codex/issue-77-abc123')
    expect(prompt).toContain('Execution requirements:')
    expect(prompt).toContain('Closes #77')
    expect(prompt).toContain(
      `Maintain a single progress comment anchored by ${PROGRESS_COMMENT_MARKER} using apps/froussard/scripts/codex-progress-comment.sh`,
    )
    expect(prompt).toContain('apps/froussard/scripts/codex-progress-comment.sh')
  })

  it('falls back to a default plan body when the approved plan is empty', () => {
    const prompt = buildCodexPrompt({
      stage: 'implementation',
      issueTitle: 'Stabilise deployment workflow',
      issueBody: 'Improve release cadence.',
      repositoryFullName: 'gregkonush/lab',
      issueNumber: 88,
      baseBranch: 'main',
      headBranch: 'codex/issue-88-xyz987',
      issueUrl: 'https://github.com/gregkonush/lab/issues/88',
      planCommentBody: '   ',
    })

    expect(prompt).toContain('"""\nNo approved plan content was provided.\n"""')
  })

  it('uses a default issue body when none is supplied', () => {
    const prompt = buildCodexPrompt({
      stage: 'planning',
      issueTitle: 'Refine metrics dashboards',
      issueBody: '   ',
      repositoryFullName: 'gregkonush/lab',
      issueNumber: 101,
      baseBranch: 'main',
      headBranch: 'codex/issue-101-abc123',
      issueUrl: 'https://github.com/gregkonush/lab/issues/101',
    })

    expect(prompt).toContain('"""\nNo description provided.\n"""')
  })

  it('throws when attempting to build a one-shot prompt directly', () => {
    expect(() =>
      buildCodexPrompt({
        stage: 'one-shot',
        issueTitle: 'Unsupported one-shot direct call',
        issueBody: 'Body',
        repositoryFullName: 'gregkonush/lab',
        issueNumber: 55,
        baseBranch: 'main',
        headBranch: 'codex/issue-55-abc123',
        issueUrl: 'https://github.com/gregkonush/lab/issues/55',
      }),
    ).toThrow(/one-shot/i)
  })
})

describe('buildCodexOneShotPrompts', () => {
  const commonOptions = {
    issueTitle: 'Ship combined workflow',
    issueBody: 'Ensure seamless handoff between planning and implementation.',
    repositoryFullName: 'gregkonush/lab',
    issueNumber: 200,
    baseBranch: 'main',
    headBranch: 'codex/issue-200-abc123',
    issueUrl: 'https://github.com/gregkonush/lab/issues/200',
  }

  it('returns both planning and implementation prompts with a placeholder plan body', () => {
    const prompts = buildCodexOneShotPrompts(commonOptions)

    expect(prompts.planning).toContain(PLAN_COMMENT_MARKER)
    expect(prompts.implementation).toContain(ONE_SHOT_PLAN_PLACEHOLDER)
    expect(prompts.implementation).toContain('Approved plan:')
  })

  it('uses provided plan body when available', () => {
    const prompts = buildCodexOneShotPrompts({
      ...commonOptions,
      planCommentBody: `${PLAN_COMMENT_MARKER}\n1. Step`,
    })

    expect(prompts.implementation).toContain('1. Step')
    expect(prompts.implementation).not.toContain(ONE_SHOT_PLAN_PLACEHOLDER)
  })
})

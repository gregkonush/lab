import { describe, expect, it } from 'vitest'

import {
  PLAN_COMMENT_MARKER,
  buildCodexBranchName,
  buildCodexPrompt,
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

    expect(prompt).toContain('Plan for the next Codex automation run. Keep it concise, specific, and executable.')
    expect(prompt).toContain('### Planning Workflow')
    expect(prompt).toContain(
      '1. Take a deliberate breath, review relevant code/tests, and jot bullet notes on constraints before writing the plan.',
    )
    expect(prompt).toContain(
      '2. Immediately add :eyes: to the issue itself (replace an existing :+1: on the issue if present) before doing anything else.',
    )
    expect(prompt).toContain(
      '3. Immediately post (or update) a single comment that reads `_Planning in progress…_` to signal work in progress.',
    )
    expect(prompt).toContain('### Plan Format')
    expect(prompt).toContain(PLAN_COMMENT_MARKER)
    expect(prompt).toContain('### Risks & Questions - blockers, assumptions, migrations, sequencing concerns.')
    expect(prompt).toContain('### Automation Handoff Notes - env vars, credentials, long jobs, temp assets to prepare.')
    expect(prompt).toContain('### Final Steps')
    expect(prompt).toContain(
      'After publishing the plan, swap the issue reaction from :eyes: to :rocket: to signal completeness.',
    )
    expect(prompt).toContain(
      'Reply to the issue with the exact phrase `execute plan` when you want automation to start implementation.',
    )
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

    expect(prompt).toContain('Execute the approved plan end to end. Stay concise and surface deviations with reasons.')
    expect(prompt).toContain('Approved plan:')
    expect(prompt).toContain('1. Step one')
    expect(prompt).toContain('Implementation branch: codex/issue-77-abc123')
    expect(prompt).toContain('Run formatters, lint, tests, and record outputs or failures.')
    expect(prompt).toContain('Closes #77')
  })
})

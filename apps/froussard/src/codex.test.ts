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

    expect(prompt).toContain('Repository: gregkonush/lab')
    expect(prompt).toContain('Issue: #77 – Improve webhook reliability')
    expect(prompt).toContain('"""\nFocus on retry logic and logging.\n"""')
    expect(prompt).toContain(PLAN_COMMENT_MARKER)
    expect(prompt.startsWith('You are GPT-5 Codex acting as the planning lead for this GitHub issue.')).toBe(true)
    expect(prompt).toContain('Replace the existing :+1: reaction on this issue with :eyes:')
    expect(prompt).toContain('_Planning in progress…_')
    expect(prompt).toContain('Respond with Markdown using this exact structure:')
    expect(prompt).toContain('### Maintainer Checklist')
    expect(prompt).toContain('replace the :eyes: reaction with :rocket:')
    expect(prompt).toContain('You have access to the full repository checkout; inspect code and tests as needed')
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

    expect(prompt).toContain('Approved plan:')
    expect(prompt).toContain('1. Step one')
    expect(prompt).toContain('Create or reuse a feature branch')
  })
})

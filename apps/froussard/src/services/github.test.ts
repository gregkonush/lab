import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { PLAN_COMMENT_MARKER } from '@/codex'
import { findLatestPlanComment, postIssueReaction } from '@/services/github'

describe('postIssueReaction', () => {
  it('reports missing token when GITHUB_TOKEN is not configured', async () => {
    const result = await postIssueReaction({
      repositoryFullName: 'owner/repo',
      issueNumber: 12,
      token: null,
      reactionContent: 'rocket',
      fetchImplementation: null,
    })

    expect(result).toEqual({ ok: false, reason: 'missing-token' })
  })

  it('rejects invalid repository names', async () => {
    const result = await postIssueReaction({
      repositoryFullName: 'invalid-owner-only',
      issueNumber: 99,
      token: 'token',
      reactionContent: 'rocket',
      fetchImplementation: null,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('invalid-repository')
    }
  })

  it('posts reaction payload to the GitHub API', async () => {
    const fetchSpy = vi.fn(async (_input: string, _init) => {
      return {
        ok: true,
        status: 201,
        text: async () => '',
      }
    })

    const result = await postIssueReaction({
      repositoryFullName: 'acme/widgets',
      issueNumber: 7,
      token: 'secret-token',
      reactionContent: 'rocket',
      apiBaseUrl: 'https://example.test/api',
      userAgent: 'custom-agent',
      fetchImplementation: fetchSpy,
    })

    expect(result).toEqual({ ok: true })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const firstCall = fetchSpy.mock.calls[0]
    if (!firstCall) {
      throw new Error('Expected fetch to be called')
    }
    const [url, init] = firstCall
    expect(url).toBe('https://example.test/api/repos/acme/widgets/issues/7/reactions')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer secret-token',
      'Content-Type': 'application/json',
      'User-Agent': 'custom-agent',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    expect(init?.body).toBe(JSON.stringify({ content: 'rocket' }))
  })

  it('propagates http errors with status and body details', async () => {
    const fetchSpy = vi.fn(async () => {
      return {
        ok: false,
        status: 403,
        text: async () => 'forbidden',
      }
    })

    const result = await postIssueReaction({
      repositoryFullName: 'acme/widgets',
      issueNumber: 7,
      token: 'secret-token',
      reactionContent: 'rocket',
      fetchImplementation: fetchSpy,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('http-error')
      expect(result.status).toBe(403)
      expect(result.detail).toBe('forbidden')
    }
  })

  it('indicates when no fetch implementation is available', async () => {
    const result = await postIssueReaction({
      repositoryFullName: 'owner/repo',
      issueNumber: 13,
      token: 'token',
      reactionContent: 'heart',
      fetchImplementation: null,
    })

    expect(result).toEqual({ ok: false, reason: 'no-fetch' })
  })

  it('surfaces network errors thrown by the fetch implementation', async () => {
    const result = await postIssueReaction({
      repositoryFullName: 'owner/repo',
      issueNumber: 99,
      token: 'token',
      reactionContent: 'eyes',
      fetchImplementation: async () => {
        throw new Error('boom')
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('network-error')
      expect(result.detail).toBe('boom')
    }
  })

  it('removes trailing slashes from the API base URL before sending the request', async () => {
    const fetchSpy = vi.fn(async (_url: string) => ({
      ok: true,
      status: 201,
      text: async () => '',
    }))

    await postIssueReaction({
      repositoryFullName: 'acme/widgets',
      issueNumber: 5,
      token: 'secret-token',
      reactionContent: 'rocket',
      apiBaseUrl: 'https://example.test/api/',
      fetchImplementation: fetchSpy,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const trailingCall = fetchSpy.mock.calls[0]
    if (!trailingCall) {
      throw new Error('Expected fetch to be called')
    }
    const [url] = trailingCall
    expect(url).toBe('https://example.test/api/repos/acme/widgets/issues/5/reactions')
  })
})

describe('findLatestPlanComment', () => {
  it('returns the latest comment containing the plan marker', async () => {
    const payload = [
      { id: 101, body: 'Regular comment' },
      { id: 202, body: `${PLAN_COMMENT_MARKER}\nApproved steps`, html_url: 'https://example.com/comment/202' },
    ]

    const result = await findLatestPlanComment({
      repositoryFullName: 'gregkonush/lab',
      issueNumber: 12,
      fetchImplementation: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.comment.id).toBe(202)
    expect(result.comment.body).toContain('Approved steps')
    expect(result.comment.htmlUrl).toBe('https://example.com/comment/202')
  })

  it('returns not-found when no comment carries the plan marker', async () => {
    const payload = [{ id: 303, body: 'No marker here' }]

    const result = await findLatestPlanComment({
      repositoryFullName: 'gregkonush/lab',
      issueNumber: 99,
      fetchImplementation: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      }),
    })

    expect(result).toEqual({ ok: false, reason: 'not-found' })
  })

  it('rejects repositories without owner and name segments', async () => {
    const result = await findLatestPlanComment({
      repositoryFullName: 'invalid-repo',
      issueNumber: 5,
      fetchImplementation: async () => {
        throw new Error('fetch should not be called')
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('invalid-repository')
    }
  })

  it('returns invalid-json when the response body is not an array', async () => {
    const result = await findLatestPlanComment({
      repositoryFullName: 'owner/repo',
      issueNumber: 4,
      fetchImplementation: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ foo: 'bar' }),
      }),
    })

    expect(result).toEqual({ ok: false, reason: 'invalid-json', detail: 'Expected array of issue comments' })
  })

  it('returns invalid-comment when id cannot be coerced to a number', async () => {
    const payload = [{ id: 'abc', body: `${PLAN_COMMENT_MARKER} body` }]

    const result = await findLatestPlanComment({
      repositoryFullName: 'owner/repo',
      issueNumber: 6,
      fetchImplementation: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(payload),
      }),
    })

    expect(result).toEqual({ ok: false, reason: 'invalid-comment', detail: 'Missing numeric comment id' })
  })

  it('propagates JSON parse errors as invalid-json', async () => {
    const result = await findLatestPlanComment({
      repositoryFullName: 'owner/repo',
      issueNumber: 7,
      fetchImplementation: async () => ({
        ok: true,
        status: 200,
        text: async () => '{invalid}',
      }),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('invalid-json')
    }
  })

  it('returns http-error when GitHub responds with failure', async () => {
    const result = await findLatestPlanComment({
      repositoryFullName: 'owner/repo',
      issueNumber: 8,
      fetchImplementation: async () => ({
        ok: false,
        status: 500,
        text: async () => 'server failure',
      }),
    })

    expect(result).toEqual({ ok: false, reason: 'http-error', status: 500, detail: 'server failure' })
  })

  it('returns network-error when fetch implementation throws', async () => {
    const result = await findLatestPlanComment({
      repositoryFullName: 'owner/repo',
      issueNumber: 9,
      fetchImplementation: async () => {
        throw new Error('network down')
      },
    })

    expect(result).toEqual({ ok: false, reason: 'network-error', detail: 'network down' })
  })
})

describe('upsertPlanComment.sh', () => {
  const scriptPath = fileURLToPath(new URL('../../scripts/upsert-plan-comment.sh', import.meta.url))
  const ghStub = `#!/usr/bin/env bash
set -euo pipefail

state_file="\${UPSERT_PLAN_STATE_FILE:?}"
mode="\${UPSERT_PLAN_MODE:?}"
log_file="\${UPSERT_PLAN_LOG:?}"

call_index="$(cat "\${state_file}" 2>/dev/null || echo "0")"

if [[ "\${call_index}" == "0" ]]; then
  echo "1" >"\${state_file}"
  if [[ "\${1:-}" == "api" ]]; then
    shift
  fi
  echo "GET $*" >>"\${log_file}"
  if [[ "\${mode}" == "create" ]]; then
    printf '[]'
  else
    printf '[{"id":42,"body":"<!-- codex:plan --> existing","html_url":"https://example.com/comment/42"}]'
  fi
  exit 0
fi

if [[ "\${call_index}" == "1" ]]; then
  echo "2" >"\${state_file}"
  if [[ "\${1:-}" == "api" ]]; then
    shift
  fi
  url="\${1:-}"
  shift || true
  method=""
  input_file=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --method)
        method="\${2:-}"
        shift 2
        ;;
      --input)
        input_file="\${2:-}"
        shift 2
        ;;
      *)
        shift
        ;;
    esac
  done

  echo "MUTATE \${method:-none} \${url:-missing}" >>"\${log_file}"

  if [[ "\${mode}" == "create" ]]; then
    if [[ "\${method}" != "POST" ]]; then
      echo "Expected POST during create, got \${method:-<none>}" >&2
      exit 1
    fi
    printf '{"id":555,"html_url":"https://example.com/comment/555","body":"<!-- codex:plan --> created"}'
  else
    if [[ "\${method}" != "PATCH" ]]; then
      echo "Expected PATCH during update, got \${method:-<none>}" >&2
      exit 1
    fi
    printf '{"id":42,"html_url":"https://example.com/comment/42","body":"<!-- codex:plan --> updated"}'
  fi
  exit 0
fi

echo "Unexpected call count" >&2
exit 1
`

  it('creates a plan comment when none exist', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codex-upsert-create-'))
    try {
      const planFile = join(tempDir, 'PLAN.md')
      writeFileSync(planFile, `${PLAN_COMMENT_MARKER}\nPlan body\n`, 'utf8')

      const stateFile = join(tempDir, 'state')
      const logFile = join(tempDir, 'log')
      writeFileSync(stateFile, '0', 'utf8')
      writeFileSync(logFile, '', 'utf8')

      const ghPath = join(tempDir, 'gh')
      writeFileSync(ghPath, ghStub, 'utf8')
      chmodSync(ghPath, 0o755)

      const output = execFileSync(scriptPath, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          ISSUE_REPO: 'acme/widgets',
          ISSUE_NUMBER: '17',
          PLAN_FILE: planFile,
          WORKTREE: process.cwd(),
          UPSERT_PLAN_MODE: 'create',
          UPSERT_PLAN_STATE_FILE: stateFile,
          UPSERT_PLAN_LOG: logFile,
        },
        encoding: 'utf8',
      })

      expect(output).toContain('action=create')
      expect(output).toContain('comment_url=https://example.com/comment/555')

      const log = readFileSync(logFile, 'utf8')
      expect(log).toContain('GET repos/acme/widgets/issues/17/comments --paginate')
      expect(log).toContain('MUTATE POST repos/acme/widgets/issues/17/comments')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('updates an existing plan comment when the marker is present', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'codex-upsert-update-'))
    try {
      const planFile = join(tempDir, 'PLAN.md')
      writeFileSync(planFile, `${PLAN_COMMENT_MARKER}\nUpdated plan body\n`, 'utf8')

      const stateFile = join(tempDir, 'state')
      const logFile = join(tempDir, 'log')
      writeFileSync(stateFile, '0', 'utf8')
      writeFileSync(logFile, '', 'utf8')

      const ghPath = join(tempDir, 'gh')
      writeFileSync(ghPath, ghStub, 'utf8')
      chmodSync(ghPath, 0o755)

      const output = execFileSync(scriptPath, {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${tempDir}:${process.env.PATH ?? ''}`,
          ISSUE_REPO: 'acme/widgets',
          ISSUE_NUMBER: '42',
          PLAN_FILE: planFile,
          WORKTREE: process.cwd(),
          UPSERT_PLAN_MODE: 'update',
          UPSERT_PLAN_STATE_FILE: stateFile,
          UPSERT_PLAN_LOG: logFile,
        },
        encoding: 'utf8',
      })

      expect(output).toContain('action=update')
      expect(output).toContain('comment_url=https://example.com/comment/42')

      const log = readFileSync(logFile, 'utf8')
      expect(log).toContain('GET repos/acme/widgets/issues/42/comments --paginate')
      expect(log).toContain('MUTATE PATCH repos/acme/widgets/issues/comments/42')
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

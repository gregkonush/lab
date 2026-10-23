import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { isMap, isSeq, parseDocument } from 'yaml'

import { repoRoot } from '../../shared/cli'
import { resolvePublishedAgentsImages } from '../resolve-published-agents-images'

describe('resolvePublishedAgentsImages', () => {
  it('reads promoted image pins while leaving the source baseline unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'promoted-agents-images-'))
    const valuesPath = join(dir, 'argocd/applications/agents/values.yaml')
    const githubOutput = join(dir, 'github-output')
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
    const values = (tag: string, digest: string) =>
      `image:\n  repository: registry.example/lab/agents\n  tag: ${tag}\n  digest: sha256:${digest.repeat(64)}\n`

    try {
      git('init', '--initial-branch=main')
      git('config', 'user.name', 'Agents CI fixture')
      git('config', 'user.email', 'agents-ci@example.invalid')
      mkdirSync(join(dir, 'argocd/applications/agents'), { recursive: true })
      writeFileSync(valuesPath, values('baseline', 'a'))
      git('add', 'argocd/applications/agents/values.yaml')
      git('commit', '-m', 'baseline')
      git('checkout', '-b', 'kargo/agents')
      writeFileSync(valuesPath, values('promoted', 'b'))
      git('commit', '-am', 'promotion')
      git('checkout', 'main')
      git('remote', 'add', 'origin', dir)

      const workflow = parseDocument(readFileSync(join(repoRoot, '.github/workflows/agents-ci.yml'), 'utf8'))
      const steps = workflow.getIn(['jobs', 'integration', 'steps'])
      if (!isSeq(steps)) throw new Error('Agents integration steps are missing')
      const step = steps.items.find((item) => isMap(item) && item.get('id') === 'promoted_agents_values')
      const script = isMap(step) ? step.get('run') : undefined
      if (typeof script !== 'string') throw new Error('Promoted Agents values step is missing')

      execFileSync('bash', ['-euo', 'pipefail', '-c', script], {
        cwd: dir,
        env: { ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: githubOutput },
        stdio: 'pipe',
      })

      const promotedPath = readFileSync(githubOutput, 'utf8')
        .split('\n')
        .find((line) => line.startsWith('values_path='))
        ?.slice('values_path='.length)
      if (!promotedPath) throw new Error('Promoted values path output is missing')
      expect(resolvePublishedAgentsImages(promotedPath).runner).toMatchObject({
        tag: 'promoted',
        digest: `sha256:${'b'.repeat(64)}`,
      })
      expect(readFileSync(valuesPath, 'utf8')).toBe(values('baseline', 'a'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('uses immutable Agents image pins from the GitOps values file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-published-agents-images-'))
    const valuesPath = join(dir, 'values.yaml')

    writeFileSync(
      valuesPath,
      `
image:
  repository: registry.example/lab/agents-controller
  tag: abcdef12
  digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
controlPlane:
  image:
    repository: registry.example/lab/agents-control-plane
    tag: control12
    digest: sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
  env:
    vars:
      AGENTS_SOURCE_HEAD_SHA: abcdef1234567890abcdef1234567890abcdef12
controllers:
  image:
    repository: registry.example/lab/agents-controller
    tag: controller12
    digest: sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
runner:
  image:
    repository: registry.example/lab/agents-codex-runner
    tag: runner12
    digest: sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
`,
      'utf8',
    )

    expect(resolvePublishedAgentsImages(relative(repoRoot, valuesPath))).toEqual({
      sourceSha: 'abcdef1234567890abcdef1234567890abcdef12',
      controlPlane: {
        repository: 'registry.example/lab/agents-control-plane',
        tag: 'control12',
        digest: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ref: 'registry.example/lab/agents-control-plane:control12@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
      controller: {
        repository: 'registry.example/lab/agents-controller',
        tag: 'controller12',
        digest: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        ref: 'registry.example/lab/agents-controller:controller12@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
      },
      runner: {
        repository: 'registry.example/lab/agents-codex-runner',
        tag: 'runner12',
        digest: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        ref: 'registry.example/lab/agents-codex-runner:runner12@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      },
    })

    rmSync(dir, { recursive: true, force: true })
  })

  it('falls back to the root image fields for omitted component values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-published-agents-images-'))
    const valuesPath = join(dir, 'values.yaml')

    writeFileSync(
      valuesPath,
      `
image:
  repository: registry.example/lab/agents-control-plane
  tag: abcdef12
  digest: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
controlPlane: {}
controllers:
  image:
    repository: registry.example/lab/agents-controller
runner:
  image:
    repository: registry.example/lab/agents-codex-runner
`,
      'utf8',
    )

    expect(resolvePublishedAgentsImages(relative(repoRoot, valuesPath))).toEqual({
      sourceSha: 'abcdef12',
      controlPlane: {
        repository: 'registry.example/lab/agents-control-plane',
        tag: 'abcdef12',
        digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ref: 'registry.example/lab/agents-control-plane:abcdef12@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      controller: {
        repository: 'registry.example/lab/agents-controller',
        tag: 'abcdef12',
        digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ref: 'registry.example/lab/agents-controller:abcdef12@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      runner: {
        repository: 'registry.example/lab/agents-codex-runner',
        tag: 'abcdef12',
        digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ref: 'registry.example/lab/agents-codex-runner:abcdef12@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    })

    rmSync(dir, { recursive: true, force: true })
  })
})

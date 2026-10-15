import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'bun:test'
import YAML from 'yaml'

test('Bayn cache alerts evaluate healthy, missing, failed and low-traffic observations with native PromQL', () => {
  const manifest = YAML.parse(
    readFileSync(
      new URL('../../../../../argocd/applications/observability/graf-mimir-rules.yaml', import.meta.url),
      'utf8',
    ),
  )
  const fixtures = readFileSync(
    new URL('../../../../../argocd/applications/observability/tests/bayn-cache-alerts.yaml', import.meta.url),
    'utf8',
  )
  const directory = mkdtempSync(join(tmpdir(), 'bayn-cache-promql-'))
  try {
    writeFileSync(join(directory, 'rules.yaml'), manifest.data['graf-rules.yaml'])
    writeFileSync(join(directory, 'tests.yaml'), fixtures)
    const result = spawnSync(process.env.PROMTOOL ?? 'promtool', ['test', 'rules', 'tests.yaml'], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (result.error !== undefined || result.status !== 0)
      throw new Error(`Native cache alert evaluation failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}, 30_000)

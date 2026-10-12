import { expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'

test('registry cleanup preserves retained graphs and fails closed before deletion', () => {
  const path = fileURLToPath(new URL('../test_cleanup.py', import.meta.url))
  const result = Bun.spawnSync(['python3', path], { stdout: 'pipe', stderr: 'pipe' })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
})

test('registry collection timeout restores writes only after the collector is gone', () => {
  const path = fileURLToPath(new URL('../test_collection.py', import.meta.url))
  const result = Bun.spawnSync(['python3', path], { stdout: 'pipe', stderr: 'pipe' })
  expect(result.exitCode, result.stderr.toString()).toBe(0)
})

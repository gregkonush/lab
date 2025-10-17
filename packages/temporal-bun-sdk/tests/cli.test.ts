import { describe, expect, it } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs, inferPackageName, projectTemplates } from '../src/bin/temporal-bun.ts'

describe('temporal-bun CLI utilities', () => {
  it('parses positional args and flags', () => {
    const { args, flags } = parseArgs(['example', '--force', '--tag', 'foo'])
    expect(args).toEqual(['example'])
    expect(flags.force).toBe(true)
    expect(flags.tag).toBe('foo')
  })

  it('infers package names safely', () => {
    expect(inferPackageName('/tmp/My Temporal Worker')).toBe('my-temporal-worker')
    expect(inferPackageName('/tmp////')).toBe('tmp')
  })

  it('writes templates without collisions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'temporal-bun-cli-'))
    const templates = projectTemplates('demo-worker')
    const seen = new Set<string>()

    for (const template of templates) {
      expect(seen.has(template.path)).toBe(false)
      seen.add(template.path)

      const fullPath = join(dir, template.path)
      await Bun.write(fullPath, template.contents)
      const contents = await readFile(fullPath, 'utf8')
      expect(contents.length).toBeGreaterThan(0)
    }

    expect(seen.has('package.json')).toBe(true)
    expect(seen.has('Dockerfile')).toBe(true)
  })
})

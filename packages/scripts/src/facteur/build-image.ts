#!/usr/bin/env bun

import { resolve } from 'node:path'
import { ensureCli, repoRoot, run } from '../shared/cli'

const execGit = (args: string[]): string => {
  const result = Bun.spawnSync(['git', ...args], { cwd: repoRoot })
  if (result.exitCode !== 0) {
    const joined = args.join(' ')
    throw new Error(`git ${joined} failed`)
  }
  return result.stdout.toString().trim()
}

const build = async () => {
  ensureCli('docker')
  ensureCli('git')

  const registry = process.env.FACTEUR_IMAGE_REGISTRY ?? 'registry.ide-newton.ts.net'
  const repository = process.env.FACTEUR_IMAGE_REPOSITORY ?? 'lab/facteur'
  const tag = process.env.FACTEUR_IMAGE_TAG ?? 'latest'
  const image = `${registry}/${repository}:${tag}`
  const context = resolve(repoRoot, process.env.FACTEUR_BUILD_CONTEXT ?? '.')
  const dockerfile = resolve(repoRoot, process.env.FACTEUR_DOCKERFILE ?? 'services/facteur/Dockerfile')
  const version = process.env.FACTEUR_VERSION ?? execGit(['describe', '--tags', '--always'])
  const commit = process.env.FACTEUR_COMMIT ?? execGit(['rev-parse', 'HEAD'])

  console.log('Building Facteur image with configuration:', {
    image,
    context,
    dockerfile,
    version,
    commit,
  })

  await run('docker', [
    'build',
    '-f',
    dockerfile,
    '-t',
    image,
    '--build-arg',
    `FACTEUR_VERSION=${version}`,
    '--build-arg',
    `FACTEUR_COMMIT=${commit}`,
    context,
  ])

  await run('docker', ['push', image])

  console.log(`Image pushed: ${image}`)
}

build().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})

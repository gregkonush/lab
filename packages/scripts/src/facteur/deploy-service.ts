#!/usr/bin/env bun

import { $ } from 'bun'
import { resolve } from 'node:path'
import { ensureCli, fatal, repoRoot } from '../shared/cli'
import { buildImage } from './build-image'

const execGit = (args: string[]): string => {
  const result = Bun.spawnSync(['git', ...args], { cwd: repoRoot })
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed`)
  }
  return result.stdout.toString().trim()
}

const main = async () => {
  ensureCli('kubectl')
  ensureCli('kn')

  const registry = process.env.FACTEUR_IMAGE_REGISTRY ?? 'registry.ide-newton.ts.net'
  const repository = process.env.FACTEUR_IMAGE_REPOSITORY ?? 'lab/facteur'
  const defaultTag = execGit(['rev-parse', '--short', 'HEAD'])
  const tag = process.env.FACTEUR_IMAGE_TAG ?? defaultTag
  const image = `${registry}/${repository}:${tag}`

  await buildImage({ registry, repository, tag })

  const overlay = resolve(repoRoot, process.env.FACTEUR_KUSTOMIZE_PATH ?? 'kubernetes/facteur/overlays/cluster')
  await $`kubectl apply -k ${overlay}`

  const serviceManifest = resolve(repoRoot, 'kubernetes/facteur/base/service.yaml')
  await $`kn service apply facteur --namespace facteur --filename ${serviceManifest} --image ${image}`
}

main().catch((error) => fatal('Failed to build and deploy facteur', error))

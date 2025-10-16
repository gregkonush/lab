#!/usr/bin/env bun

import { resolve } from 'node:path'
import { ensureCli, fatal, repoRoot, run } from '../shared/cli'

const main = async () => {
  ensureCli('kubectl')

  const overlay = resolve(repoRoot, process.env.FACTEUR_KUSTOMIZE_PATH ?? 'kubernetes/facteur/overlays/cluster')

  const extraArgs = process.argv.slice(2)
  const unsupportedArgs = extraArgs.filter((arg) => arg !== '--dry-run')
  if (unsupportedArgs.length > 0) {
    fatal(`Unsupported flags: ${unsupportedArgs.join(', ')}`)
  }

  const dryRun = extraArgs.includes('--dry-run') ? ['--dry-run=server'] : []

  await run('kubectl', ['apply', '-k', overlay, ...dryRun])
}

main().catch((error) => fatal('Failed to deploy facteur manifests', error))

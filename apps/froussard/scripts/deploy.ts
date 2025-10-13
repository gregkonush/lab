#!/usr/bin/env bun
import process from 'node:process'

import { $ } from 'bun'

const run = async () => {
  $.throws(true)

  const envVersion = process.env.FROUSSARD_VERSION?.trim()
  const envCommit = process.env.FROUSSARD_COMMIT?.trim()

  const version =
    envVersion && envVersion.length > 0 ? envVersion : (await $`git describe --tags --always`.text()).trim()
  const commit = envCommit && envCommit.length > 0 ? envCommit : (await $`git rev-parse HEAD`.text()).trim()

  if (!version) {
    throw new Error('Failed to determine FROUSSARD_VERSION')
  }
  if (!commit) {
    throw new Error('Failed to determine FROUSSARD_COMMIT')
  }

  console.log(`Deploying froussard version ${version} (${commit})`)

  const env = {
    ...process.env,
    FROUSSARD_VERSION: version,
    FROUSSARD_COMMIT: commit,
  }

  const args = Bun.argv.slice(2)
  const passThrough = args.length > 0 ? ['--', ...args] : []

  await $.env(env)`pnpm --filter froussard run deploy ${passThrough}`
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

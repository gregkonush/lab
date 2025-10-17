#!/usr/bin/env bun
import { runWorker } from '../worker.js'

const main = async () => {
  await runWorker()
}

main().catch((error) => {
  console.error('[temporal-bun-worker] failed to start:', error instanceof Error ? error.message : error)
  process.exit(1)
})

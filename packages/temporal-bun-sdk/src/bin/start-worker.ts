#!/usr/bin/env bun

import { createWorker } from '../worker.ts'

const main = async () => {
  const { worker } = await createWorker()

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down Temporal worker…`)
    await worker.shutdown()
    process.exit(0)
  }

  process.on('SIGINT', () => {
    void shutdown('SIGINT')
  })
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM')
  })

  await worker.run()
}

await main().catch((error) => {
  console.error('Fatal error while running Temporal worker:', error)
  process.exit(1)
})

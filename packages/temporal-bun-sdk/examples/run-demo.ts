#!/usr/bin/env bun
import { createTemporalClient } from '../src/client.ts'
import { loadTemporalConfig } from '../src/config.ts'

const main = async () => {
  const config = await loadTemporalConfig()
  console.log('[demo] using Temporal target:', config.address)

  try {
    const { client } = await createTemporalClient({ config })
    console.log('[demo] Temporal client handle established for namespace:', client.config.namespace)
    client.close()
    console.log('[demo] closed client handle')
  } catch (error) {
    console.error('[demo] failed to establish Temporal client:', error)
    process.exitCode = 1
  }
}

void main()

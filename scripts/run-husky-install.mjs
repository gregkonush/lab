#!/usr/bin/env node

const log = (message) => {
  console.log(`[prepare] ${message}`)
}

const skip = (reason) => {
  log(reason)
  process.exit(0)
}

if (process.env.CI === 'true' || process.env.HUSKY === '0') {
  skip('Husky installation skipped in CI environment.')
}

let huskyInstall
try {
  ;({ default: huskyInstall } = await import('husky'))
} catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
    skip('Husky package not found; skipping git hook installation.')
  }
  throw error
}

try {
  const result = huskyInstall()
  if (typeof result === 'string' && result.length > 0) {
    log(result)
  }
  process.exit(0)
} catch (error) {
  console.error(`[prepare] Failed to run husky install: ${error.message}`)
  process.exit(1)
}

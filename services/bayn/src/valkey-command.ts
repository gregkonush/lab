import { randomUUID } from 'node:crypto'

import { NodeRuntime } from '@effect/platform-node'
import { Effect, Layer, Option } from 'effect'

import { ValkeyCache, ValkeyCacheError, ValkeyCacheLive } from './valkey-cache'
import { makeConfiguredTelemetryRuntimeLayer } from './telemetry'

export const verifyValkeyClient = Effect.gen(function* () {
  const cache = yield* ValkeyCache
  const key = `bayn:client-acceptance:${randomUUID()}`
  yield* Effect.addFinalizer(() => cache.remove(key).pipe(Effect.orDie))
  const missing = yield* cache.get(key)
  if (Option.isSome(missing))
    return yield* new ValkeyCacheError({ operation: 'verify', message: 'Expected cache miss' })
  yield* cache.put({ key, value: 'verified', ttlMs: 300_000 })
  const value = yield* cache.get(key)
  if (Option.getOrNull(value) !== 'verified')
    return yield* new ValkeyCacheError({ operation: 'verify', message: 'Cache read did not match write' })
  yield* cache.remove(key)
  if (Option.isSome(yield* cache.get(key)))
    return yield* new ValkeyCacheError({ operation: 'verify', message: 'Deleted cache key remained readable' })
  yield* cache.put({ key, value: 'expires', ttlMs: 50 })
  yield* Effect.sleep('100 millis')
  if (Option.isSome(yield* cache.get(key)))
    return yield* new ValkeyCacheError({ operation: 'verify', message: 'Cache key outlived its TTL' })
  yield* Effect.logInfo('Bayn Valkey client acceptance passed').pipe(
    Effect.annotateLogs({ checks: ['miss', 'write', 'read', 'delete', 'expiry'] }),
  )
}).pipe(Effect.scoped)

if (import.meta.main && process.argv.includes('--help')) {
  NodeRuntime.runMain(
    Effect.logInfo(
      'Usage: valkey-command.js; requires VALKEY_HOST, VALKEY_PASSWORD and mounted TLS client material. Verifies cache miss, write, read, deletion and expiry.',
    ),
  )
} else if (import.meta.main) {
  NodeRuntime.runMain(
    verifyValkeyClient.pipe(
      // @effect-diagnostics-next-line strictEffectProvide:off -- command entry point owns the scoped cache client
      Effect.provide(
        ValkeyCacheLive.pipe(Layer.provideMerge(makeConfiguredTelemetryRuntimeLayer('bayn-valkey-client'))),
      ),
    ),
  )
}

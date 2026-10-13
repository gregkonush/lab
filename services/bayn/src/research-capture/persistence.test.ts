import { expect, test } from 'bun:test'
import { Deferred, Effect, Fiber, Result } from 'effect'
import { TestClock } from 'effect/testing'

import { provideTestLayer } from '../effect-test-support'
import { captureEvent } from './capture.test-support'
import { decodeResearchCaptureExportChunk, type ResearchCaptureObject } from './export'
import { makeResearchCaptureRecorder } from './recorder'

const options = {
  captureId: 'object-owned-metadata',
  sourceRevision: 'a'.repeat(40),
  maximumQueuedReceipts: 1024,
  maximumQueuedBytes: 4 * 1024 * 1024,
  maximumReceiptBytes: 64 * 1024,
  flushIntervalMs: 1000,
  writeTimeoutMs: 1000,
}

test('raw data chunks commit once to objects without a synchronous SQL copy', async () => {
  const objects: ResearchCaptureObject[] = []
  let appends = 0
  const seal = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const recorder = yield* makeResearchCaptureRecorder(
          {
            append: () =>
              Effect.sync(() => {
                appends++
              }),
            seal: () => Effect.void,
          },
          options,
          {
            putVerified: (object) =>
              Effect.sync(() => {
                objects.push(object)
              }),
          },
        )
        recorder.record(captureEvent('STARTED'))
        recorder.record(captureEvent('STOPPED'))
        return yield* recorder.finish
      }),
    ),
  )
  expect(appends).toBe(0)
  expect(seal?.invalidations).toEqual([])
  expect(seal?.persistedReceipts).toBe(2)
  const first = objects[0]
  if (first === undefined) throw new Error('Missing durable data frame')
  expect(Result.getOrThrow(decodeResearchCaptureExportChunk(first)).chunk.receipts).toHaveLength(2)
})

test('bounded asynchronous capture can retain a real storage operation lasting over one second', () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const chunkStarted = yield* Deferred.make<void>()
        const sealStarted = yield* Deferred.make<void>()
        let puts = 0
        const recorder = yield* makeResearchCaptureRecorder(
          { append: () => Effect.void, seal: () => Effect.void },
          { ...options, maximumQueuedBytes: 64 * 1024 * 1024, maximumQueuedReceipts: 16_384, writeTimeoutMs: 30_000 },
          {
            putVerified: () =>
              Effect.gen(function* () {
                yield* Deferred.succeed(puts++ === 0 ? chunkStarted : sealStarted, undefined)
                yield* Effect.sleep(2000)
              }),
          },
        )
        recorder.record(captureEvent('STARTED'))
        recorder.record(captureEvent('STOPPED'))
        const finishing = yield* recorder.finish.pipe(Effect.forkChild)
        yield* Deferred.await(chunkStarted)
        yield* TestClock.adjust(2000)
        yield* Deferred.await(sealStarted)
        yield* TestClock.adjust(2000)
        expect((yield* Fiber.join(finishing))?.invalidations).toEqual([])
        expect((yield* recorder.status).persistedReceipts).toBe(2)
      }),
    ).pipe(provideTestLayer(TestClock.layer())),
  ))

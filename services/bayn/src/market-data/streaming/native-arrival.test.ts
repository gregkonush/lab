import { expect, test } from 'bun:test'
import { gzipSync } from 'node:zlib'
import { Deferred, Effect, Exit, Result } from 'effect'
import fc from 'fast-check'

import { canonicalHashV1OrThrow, sha256 } from '../../hash'
import {
  decodeNativeArrivalChunk,
  makeNativeArrivalChunk,
  nativeArrival,
  NativeArrivalCaptureError,
  type NativeArrivalChunk,
} from './native-arrival'
import { makeNativeArrivalJournal, type NativeArrivalEnd, type NativeArrivalStore } from './native-arrival-journal'
import {
  nativeArrivalEpochFixture as epoch,
  nativeArrivalObservationFixture as observation,
} from './native-arrival.test-support'
import { CaptureDisposition } from './transport-evidence'
import { checkProperty } from '../../testing/property-test-support'
import { decodeKafkaTransportValue } from './kafka'

test('native chunks preserve exact non-ASCII bytes, equal arrival times and exceptional transport timestamps', () => {
  const records = [
    nativeArrival(epoch, observation(1)),
    nativeArrival(epoch, {
      ...observation(2),
      availableAtMs: 1_001,
      record: { ...observation(2).record, timestampMs: Number.NaN },
      disposition: CaptureDisposition.Rejected,
    }),
    nativeArrival(epoch, {
      ...observation(3),
      record: { ...observation(3).record, timestampMs: -0 },
      assignmentInvalidated: true,
      disposition: CaptureDisposition.Ignored,
    }),
    nativeArrival(epoch, {
      ...observation(4),
      record: {
        ...observation(4).record,
        tombstone: true,
        rawValue: null,
        rawValueSha256: null,
        rawByteLength: null,
        value: '',
      },
      disposition: CaptureDisposition.Rejected,
    }),
  ]
  const chunk = Result.getOrThrow(makeNativeArrivalChunk(epoch, 0, null, records))
  expect(Result.getOrThrow(decodeNativeArrivalChunk(chunk))).toEqual(records)
  expect(chunk.header.lastConsumerSequence).toBe(4)
  expect(chunk.header.recordsHash).toBe(sha256(records.map((record) => JSON.stringify(record) + '\n').join('')))
})

test('native chunk validation rejects changed bytes, missing deliveries and rewritten raw identity', () => {
  const first = nativeArrival(epoch, observation(1))
  const second = nativeArrival(epoch, observation(2))
  const records = [first, second]
  const original = Result.getOrThrow(makeNativeArrivalChunk(epoch, 0, null, records))
  const changedBytes = Uint8Array.from(original.compressed)
  changedBytes[0] = 0
  expect(Result.isFailure(decodeNativeArrivalChunk({ ...original, compressed: changedBytes }))).toBe(true)
  for (const changed of [
    [second],
    [first, { ...second, receipt: { ...second.receipt, consumerSequence: 3 } }],
    [first, { ...second, rawValueBase64: Buffer.from('forged').toString('base64') }],
  ]) {
    const text = changed.map((record) => JSON.stringify(record) + '\n').join('')
    const compressed = gzipSync(text)
    const header = {
      ...original.header,
      uncompressedBytes: Buffer.byteLength(text),
      recordsHash: sha256(text),
      compressedHash: sha256(compressed),
    }
    expect(
      Result.isFailure(decodeNativeArrivalChunk({ header, contentHash: canonicalHashV1OrThrow(header), compressed })),
    ).toBe(true)
  }
})

test('a clock regression recovered within one chunk cannot be sealed as complete retained evidence', async () => {
  const inputs = [100, 90, 100].map((availableAtMs, index) => ({ ...observation(index + 1), availableAtMs }))
  expect(
    Result.isFailure(
      makeNativeArrivalChunk(
        epoch,
        0,
        null,
        inputs.map((input) => nativeArrival(epoch, input)),
      ),
    ),
  ).toBe(true)
  const { chunks, ends, store } = memoryStore()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const capture = yield* makeNativeArrivalJournal(epoch, store)
        for (const input of inputs) yield* capture.observe(input)
      }),
    ),
  )
  expect(chunks).toHaveLength(0)
  expect(ends[0]).toMatchObject({ status: 'INCOMPLETE', observedConsumerSequence: 3, durableConsumerSequence: 0 })
})

const memoryStore = () => {
  const chunks: NativeArrivalChunk[] = []
  const ends: NativeArrivalEnd[] = []
  const store: NativeArrivalStore = {
    begin: () => Effect.void,
    append: (batch) =>
      Effect.sync(() => {
        chunks.push(...batch)
      }),
    end: (end) =>
      Effect.sync(() => {
        ends.push(end)
      }),
  }
  return { chunks, ends, store }
}

test('scope finalization flushes the last short chunk and confirms its exact durable prefix', async () => {
  const { chunks, ends, store } = memoryStore()
  const capture = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const capture = yield* makeNativeArrivalJournal(epoch, store)
        yield* capture.observe(observation(1))
        yield* capture.observe(observation(2))
        expect(chunks).toHaveLength(0)
        return capture
      }),
    ),
  )
  expect(chunks).toHaveLength(1)
  expect(Result.getOrThrow(decodeNativeArrivalChunk(chunks[0] ?? expect.unreachable()))).toHaveLength(2)
  expect(ends).toEqual([
    {
      captureId: epoch.captureId,
      status: 'STOPPED',
      observedConsumerSequence: 2,
      durableConsumerSequence: 2,
      lastChunkHash: chunks[0]?.contentHash,
      reason: null,
      consumerScopeCompleted: true,
    },
  ])
  expect(capture.status()).toMatchObject({ status: 'STOPPED', durableConsumerSequence: 2, queuedCompressedBytes: 0 })
})

test('compressed queue overflow retains a contiguous prefix and permanently marks the missing suffix incomplete', async () => {
  const { chunks, ends, store } = memoryStore()
  const capture = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const paused = yield* Deferred.make<void>()
        const capture = yield* makeNativeArrivalJournal(
          epoch,
          { ...store, append: (batch) => Deferred.await(paused).pipe(Effect.andThen(store.append(batch))) },
          { chunkBytes: 1, queueBytes: 1_500 },
        )
        for (let sequence = 1; sequence <= 100; sequence++)
          yield* capture.observe(observation(sequence, sha256(String(sequence)).repeat(4)))
        expect(capture.status().status).toBe('INCOMPLETE')
        expect(capture.status().queuedCompressedBytes).toBeLessThanOrEqual(1_500)
        yield* Deferred.succeed(paused, undefined)
        yield* Effect.yieldNow
        return capture
      }),
    ),
  )
  expect(chunks.length).toBeGreaterThan(0)
  expect(chunks.length).toBeLessThan(100)
  expect(chunks.map((chunk) => chunk.header.firstConsumerSequence)).toEqual(chunks.map((_, index) => index + 1))
  expect(ends[0]).toMatchObject({
    status: 'INCOMPLETE',
    observedConsumerSequence: 100,
    durableConsumerSequence: chunks.length,
  })
  expect(capture.status().status).toBe('INCOMPLETE')
})

test('missing raw bytes invalidate retention rather than fabricate an original arrival', async () => {
  const { chunks, ends, store } = memoryStore()
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const capture = yield* makeNativeArrivalJournal(epoch, store)
        const { rawValue: _rawValue, ...missing } = observation(1).record
        yield* capture.observe({ ...observation(1), record: missing })
        expect(capture.status().status).toBe('INCOMPLETE')
      }),
    ),
  )
  expect(chunks).toHaveLength(0)
  expect(ends[0]).toMatchObject({ status: 'INCOMPLETE', observedConsumerSequence: 1, durableConsumerSequence: 0 })
})

test('failed persistence leaves the epoch unsealed and cannot claim a durable delivery', async () => {
  const { ends, store } = memoryStore()
  const capture = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const capture = yield* makeNativeArrivalJournal(
          epoch,
          {
            ...store,
            append: () => Effect.fail(new NativeArrivalCaptureError({ message: 'synthetic persistence failure' })),
          },
          { chunkBytes: 1, queueBytes: 1_500 },
        )
        yield* capture.observe(observation(1))
        return capture
      }),
    ),
  )
  expect(ends).toHaveLength(0)
  expect(capture.status()).toMatchObject({ status: 'INCOMPLETE', durableConsumerSequence: 0 })
})

test('a failed epoch opening cannot start a writer or fabricate retained deliveries', async () => {
  const { chunks, ends, store } = memoryStore()
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      makeNativeArrivalJournal(epoch, {
        ...store,
        begin: () => Effect.fail(new NativeArrivalCaptureError({ message: 'synthetic opening failure' })),
      }),
    ),
  )
  expect(Exit.isFailure(exit)).toBe(true)
  expect(chunks).toHaveLength(0)
  expect(ends).toHaveLength(0)
})

test('interrupting the owner still flushes and finalizes the observed prefix exactly once', async () => {
  const { chunks, ends, store } = memoryStore()
  const exit = await Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const capture = yield* makeNativeArrivalJournal(epoch, store)
        yield* capture.observe(observation(1))
        return yield* Effect.interrupt
      }),
    ),
  )
  expect(Exit.hasInterrupts(exit)).toBe(true)
  expect(chunks).toHaveLength(1)
  expect(ends).toHaveLength(1)
  expect(ends[0]).toMatchObject({
    status: 'STOPPED',
    observedConsumerSequence: 1,
    durableConsumerSequence: 1,
    consumerScopeCompleted: false,
  })
})

test('property: original bytes and delivered sequence survive chunking while compressed-byte substitutions fail', () => {
  checkProperty(
    'native-arrival-byte-continuity',
    fc.property(
      fc.array(fc.uint8Array({ maxLength: 512 }), { minLength: 1, maxLength: 16 }),
      fc.integer({ min: 1, max: 8 }),
      (values, width) => {
        const records = values.map((value, index) =>
          nativeArrival(epoch, {
            ...observation(index + 1),
            availableAtMs: 1_000 + Math.floor(index / 2),
            record: { ...observation(index + 1).record, ...decodeKafkaTransportValue(Buffer.from(value), true, true) },
          }),
        )
        if (records.length >= 3) {
          const first = records[0]
          const second = records[1]
          if (first === undefined || second === undefined) throw new Error('Missing generated clock boundary')
          const regressed = [first, { ...second, availableAtMs: first.availableAtMs - 1 }, ...records.slice(2)]
          expect(Result.isFailure(makeNativeArrivalChunk(epoch, 0, null, regressed))).toBe(true)
        }
        let previous: string | null = null
        for (let index = 0; index < records.length; index += width) {
          const subset = records.slice(index, index + width)
          const chunk: NativeArrivalChunk = Result.getOrThrow(
            makeNativeArrivalChunk(epoch, index / width, previous, subset),
          )
          expect(Result.getOrThrow(decodeNativeArrivalChunk(chunk))).toEqual(subset)
          expect(chunk.header.firstConsumerSequence).toBe(index + 1)
          expect(chunk.header.previousHash).toBe(previous)
          const changed = Uint8Array.from(chunk.compressed)
          changed[0] = (changed[0] ?? 0) ^ 1
          expect(Result.isFailure(decodeNativeArrivalChunk({ ...chunk, compressed: changed }))).toBe(true)
          previous = chunk.contentHash
        }
      },
    ),
  )
})

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { NodeServices } from '@effect/platform-node'
import { PgClient } from '@effect/sql-pg'
import { Deferred, Effect, Exit, Fiber, Layer, ManagedRuntime, Redacted, Result } from 'effect'

import { canonicalJsonV1Result, canonicalHashV1Result } from '../hash'
import {
  decodeNativeArrivalChunk,
  makeNativeArrivalChunk,
  nativeArrival,
  type NativeArrivalChunk,
} from '../market-data/streaming/native-arrival'
import {
  nativeArrivalEpochFixture as epoch,
  nativeArrivalObservationFixture as observation,
} from '../market-data/streaming/native-arrival.test-support'
import { baynTestPostgresUrl } from '../test-environment.test-support'
import { makeNativeArrivalJournal } from '../market-data/streaming/native-arrival-journal'
import { makeNativeArrivalStore, readNativeArrivalChunks, readNativeArrivalEpoch } from './native-arrival-postgres'
import { PostgresClientLive } from './postgres-client'
import { postgresMigrations } from './postgres-migrations'

const testUrl = baynTestPostgresUrl ?? 'postgresql://bayn@127.0.0.1:55436/bayn_native_arrival_test'
const describePostgres = baynTestPostgresUrl === undefined ? describe.skip : describe
const makeRuntime = (operationTimeoutMs: number) =>
  ManagedRuntime.make(
    PostgresClientLive({
      operationTimeoutMs,
      postgres: { url: Redacted.make(testUrl), tls: false, caPath: '/unused' },
    }).pipe(Layer.provideMerge(NodeServices.layer)),
  )
const chunk = (ordinal: number, previousHash: string | null) =>
  Result.getOrThrow(
    makeNativeArrivalChunk(epoch, ordinal, previousHash, [nativeArrival(epoch, observation(ordinal + 1))]),
  )

describePostgres('PostgreSQL native arrival retention', () => {
  let runtime: ReturnType<typeof makeRuntime>
  beforeAll(() => {
    const parsed = new URL(testUrl)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Native arrival integration tests require a local _test database')
    runtime = makeRuntime(5000)
  })
  beforeEach(async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* sql`DROP SCHEMA public CASCADE`
        yield* sql`CREATE SCHEMA public`
        yield* postgresMigrations
      }),
    )
  })
  afterAll(async () => {
    await runtime?.dispose()
  })

  test('persists exact bytes, immutable epoch metadata and idempotent concurrent chunk acknowledgements', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const store = makeNativeArrivalStore(sql)
        const first = chunk(0, null)
        yield* store.begin(epoch)
        yield* store.begin(epoch)
        yield* Effect.all([store.append([first]), store.append([first])], { concurrency: 2 })
        expect(yield* readNativeArrivalEpoch(sql, epoch.captureId)).toEqual(epoch)
        expect(yield* readNativeArrivalChunks(sql, epoch.captureId, -1)).toEqual([first])
        expect(yield* sql`SELECT count(*)::int AS count FROM native_arrival_chunks`).toEqual([{ count: 1 }])
      }),
    )
  })

  test('a failed ordered append rolls back its whole batch and a changed duplicate cannot replace evidence', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const store = makeNativeArrivalStore(sql)
        const first = chunk(0, null)
        yield* store.begin(epoch)
        expect(Exit.isFailure(yield* Effect.exit(store.append([first, chunk(2, first.contentHash)])))).toBe(true)
        expect(yield* readNativeArrivalChunks(sql, epoch.captureId, -1)).toEqual([])
        yield* store.append([first])
        const changed = Result.getOrThrow(
          makeNativeArrivalChunk(epoch, 0, null, [nativeArrival(epoch, observation(1, 'different'))]),
        )
        expect(Exit.isFailure(yield* Effect.exit(store.append([changed])))).toBe(true)
        expect(yield* readNativeArrivalChunks(sql, epoch.captureId, -1)).toEqual([first])
      }),
    )
  })

  test('a backpressured journal resumes into PostgreSQL with every original delivery exactly once', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const store = makeNativeArrivalStore(sql)
        const paused = yield* Deferred.make<void>()
        const writing = yield* Deferred.make<void>()
        const capture = yield* Effect.scoped(
          Effect.gen(function* () {
            const capture = yield* makeNativeArrivalJournal(
              epoch,
              {
                ...store,
                append: (batch) =>
                  Deferred.succeed(writing, undefined).pipe(
                    Effect.andThen(Deferred.await(paused)),
                    Effect.andThen(store.append(batch)),
                  ),
              },
              { chunkBytes: 1, queueBytes: 1_500 },
            )
            const producer = yield* Effect.forEach(
              Array.from({ length: 100 }, (_, index) => index + 1),
              (sequence) => capture.observe(observation(sequence)),
              { discard: true },
            ).pipe(Effect.forkChild)
            yield* Deferred.await(writing)
            for (let turn = 0; turn < 20; turn++) yield* Effect.yieldNow
            const pressured = capture.status()
            yield* Deferred.succeed(paused, undefined)
            yield* Fiber.join(producer)
            expect(pressured.status).toBe('RECORDING')
            expect(pressured.observedConsumerSequence).toBeLessThan(100)
            expect(pressured.queuedCompressedBytes).toBeLessThanOrEqual(1_500)
            return capture
          }),
        )
        const retained: NativeArrivalChunk[] = []
        while (retained.length < 100) {
          const page = yield* readNativeArrivalChunks(sql, epoch.captureId, retained.length - 1)
          expect(page.length).toBeGreaterThan(0)
          retained.push(...page)
        }
        expect(retained).toHaveLength(100)
        expect(retained.map((chunk) => chunk.header.firstConsumerSequence)).toEqual(
          Array.from({ length: 100 }, (_, index) => index + 1),
        )
        expect(capture.status()).toMatchObject({
          status: 'STOPPED',
          observedConsumerSequence: 100,
          durableConsumerSequence: 100,
          queuedCompressedBytes: 0,
        })
        expect(yield* sql`SELECT count(*)::int AS count FROM native_arrival_chunks`).toEqual([{ count: 100 }])
      }),
    )
  })

  test('bootstrap backlog persists its exact prefix under a real PostgreSQL statement deadline', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* sql`CREATE FUNCTION native_arrival_test_insert_delay() RETURNS trigger LANGUAGE plpgsql AS $delay$
          BEGIN
            PERFORM pg_sleep(0.02);
            RETURN NEW;
          END $delay$`
        yield* sql`CREATE TRIGGER native_arrival_test_insert_delay BEFORE INSERT ON native_arrival_chunks
          FOR EACH ROW EXECUTE FUNCTION native_arrival_test_insert_delay()`
      }),
    )
    const bounded = makeRuntime(2000)
    try {
      await bounded.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient
          const store = makeNativeArrivalStore(sql)
          const writing = yield* Deferred.make<void>()
          const resume = yield* Deferred.make<void>()
          const inputs = Array.from({ length: 96 }, (_, index) => observation(index + 1))
          const capture = yield* Effect.scoped(
            Effect.gen(function* () {
              const capture = yield* makeNativeArrivalJournal(
                epoch,
                {
                  ...store,
                  append: (batch) =>
                    Deferred.succeed(writing, undefined).pipe(
                      Effect.andThen(Deferred.await(resume)),
                      Effect.andThen(store.append(batch)),
                    ),
                },
                { chunkBytes: 1, queueBytes: 64 * 1024 * 1024 },
              )
              for (const input of inputs) yield* capture.observe(input)
              yield* Deferred.await(writing)
              yield* Deferred.succeed(resume, undefined)
              while (
                capture.status().status === 'RECORDING' &&
                capture.status().durableConsumerSequence < inputs.length
              )
                yield* Effect.yieldNow
              return capture
            }),
          )
          expect(capture.status()).toMatchObject({
            status: 'STOPPED',
            observedConsumerSequence: inputs.length,
            durableConsumerSequence: inputs.length,
            queuedCompressedBytes: 0,
          })
          const retained: NativeArrivalChunk[] = []
          while (retained.length < inputs.length) {
            const page = yield* readNativeArrivalChunks(sql, epoch.captureId, retained.length - 1)
            expect(page.length).toBeGreaterThan(0)
            retained.push(...page)
          }
          expect(retained.flatMap((chunk) => Result.getOrThrow(decodeNativeArrivalChunk(chunk)))).toEqual(
            inputs.map((input) => nativeArrival(epoch, input)),
          )
          expect(yield* sql`SELECT count(*)::int AS count FROM native_arrival_chunks`).toEqual([
            { count: inputs.length },
          ])
          expect(yield* sql`SELECT payload->>'status' AS status FROM native_arrival_ends`).toEqual([
            { status: 'STOPPED' },
          ])
        }),
      )
    } finally {
      await bounded.dispose()
    }
  }, 15_000)

  test('shutdown recovers a committed chunk whose acknowledgement was interrupted without duplicating it', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const store = makeNativeArrivalStore(sql)
        const persisted = yield* Deferred.make<void>()
        let calls = 0
        const capture = yield* Effect.scoped(
          Effect.gen(function* () {
            const capture = yield* makeNativeArrivalJournal(
              epoch,
              {
                ...store,
                append: (chunks) =>
                  store.append(chunks).pipe(
                    Effect.andThen(
                      Effect.suspend(() => {
                        calls++
                        return calls === 1
                          ? Deferred.succeed(persisted, undefined).pipe(Effect.andThen(Effect.never))
                          : Effect.void
                      }),
                    ),
                  ),
              },
              { chunkBytes: 1, queueBytes: 16 * 1024 * 1024 },
            )
            yield* capture.observe(observation(1))
            yield* Deferred.await(persisted)
            return capture
          }),
        )
        expect(calls).toBe(2)
        expect(capture.status()).toMatchObject({ status: 'STOPPED', durableConsumerSequence: 1 })
        expect(yield* sql`SELECT count(*)::int AS count FROM native_arrival_chunks`).toEqual([{ count: 1 }])
        expect(yield* sql`SELECT payload->>'status' AS status FROM native_arrival_ends`).toEqual([
          { status: 'STOPPED' },
        ])
      }),
    )
  })

  test('sealing requires the exact stored prefix, forbids new chunks and permits an identical retry', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const store = makeNativeArrivalStore(sql)
        const first = chunk(0, null)
        yield* store.begin(epoch)
        yield* store.append([first])
        const end = {
          captureId: epoch.captureId,
          status: 'STOPPED',
          observedConsumerSequence: 1,
          durableConsumerSequence: 1,
          lastChunkHash: first.contentHash,
          reason: null,
          consumerScopeCompleted: true,
        } as const
        expect(Exit.isFailure(yield* Effect.exit(store.end({ ...end, durableConsumerSequence: 0 })))).toBe(true)
        yield* store.end(end)
        yield* store.end(end)
        yield* store.append([first])
        expect(Exit.isFailure(yield* Effect.exit(store.append([chunk(1, first.contentHash)])))).toBe(true)
        expect(yield* sql`SELECT count(*)::int AS count FROM native_arrival_ends`).toEqual([{ count: 1 }])
      }),
    )
  })

  test('null or absent required header fields and changed compressed bytes fail the SQL boundary', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const store = makeNativeArrivalStore(sql)
        const first = chunk(0, null)
        yield* store.begin(epoch)
        for (const header of [
          { ...first.header, firstConsumerSequence: null },
          { ...first.header, lastAvailableAtMs: null },
          { ...first.header, recordsHash: null },
        ]) {
          const payload = Result.getOrThrow(canonicalJsonV1Result(header))
          const contentHash = Result.getOrThrow(canonicalHashV1Result(header))
          expect(
            Exit.isFailure(
              yield* Effect.exit(sql`INSERT INTO native_arrival_chunks (capture_id,ordinal,content_hash,header,compressed)
          VALUES (${epoch.captureId},0,${contentHash},${payload},${Buffer.from(first.compressed)})`),
            ),
          ).toBe(true)
        }
        expect(
          Exit.isFailure(yield* Effect.exit(store.append([{ ...first, compressed: Uint8Array.of(0, 1, 2) }]))),
        ).toBe(true)
        expect(yield* readNativeArrivalChunks(sql, epoch.captureId, -1)).toEqual([])
      }),
    )
  })

  test('an internally consistent chunk cannot substitute a different native consumer epoch', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const store = makeNativeArrivalStore(sql)
        yield* store.begin(epoch)
        const record = nativeArrival(epoch, observation(1))
        const changed = Result.getOrThrow(
          makeNativeArrivalChunk(epoch, 0, null, [
            {
              ...record,
              receipt: { ...record.receipt, consumerEpoch: 'different-consumer' },
            },
          ]),
        )
        yield* store.append([changed])
        expect(Exit.isFailure(yield* Effect.exit(readNativeArrivalChunks(sql, epoch.captureId, -1)))).toBe(true)
      }),
    )
  })

  test('reads bounded pages and retains a hash-linked delivery sequence across the page boundary', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const store = makeNativeArrivalStore(sql)
        yield* store.begin(epoch)
        let previous: string | null = null
        const all: NativeArrivalChunk[] = []
        for (let ordinal = 0; ordinal < 35; ordinal++) {
          const next = chunk(ordinal, previous)
          all.push(next)
          previous = next.contentHash
        }
        yield* store.append(all)
        const first = yield* readNativeArrivalChunks(sql, epoch.captureId, -1)
        const second = yield* readNativeArrivalChunks(sql, epoch.captureId, 31)
        expect(first).toHaveLength(32)
        expect(second).toHaveLength(3)
        expect([...first, ...second]).toEqual(all)
        const firstLast = first.at(-1)
        const secondFirst = second[0]
        if (firstLast === undefined || secondFirst === undefined) throw new Error('Missing retained page boundary')
        expect(secondFirst.header.previousHash).toBe(firstLast.contentHash)
      }),
    )
  })

  test('retained epochs, chunks and final markers reject update, deletion and truncation', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const store = makeNativeArrivalStore(sql)
        const first = chunk(0, null)
        yield* store.begin(epoch)
        yield* store.append([first])
        yield* store.end({
          captureId: epoch.captureId,
          status: 'STOPPED',
          observedConsumerSequence: 1,
          durableConsumerSequence: 1,
          lastChunkHash: first.contentHash,
          reason: null,
          consumerScopeCompleted: true,
        })
        for (const table of ['native_arrival_epochs', 'native_arrival_chunks', 'native_arrival_ends']) {
          expect(Exit.isFailure(yield* Effect.exit(sql.unsafe(`DELETE FROM ${table}`)))).toBe(true)
          expect(Exit.isFailure(yield* Effect.exit(sql.unsafe(`UPDATE ${table} SET capture_id=capture_id`)))).toBe(true)
          expect(Exit.isFailure(yield* Effect.exit(sql.unsafe(`TRUNCATE ${table} CASCADE`)))).toBe(true)
        }
      }),
    )
  })
})

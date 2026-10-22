import { expect, test } from 'bun:test'
import { PgClient } from '@effect/sql-pg'
import { Effect, Exit, Layer, Result } from 'effect'

import { canonicalHashV1Result } from '../../hash'
import { streamingFixture } from '../../testing/streaming-market-fixture'
import { IntradayMarketData } from '../intraday/model'
import { KafkaMarketProjection } from './kafka'
import { hasStreamingReproductionProof, reproduceStreamingSnapshot, verifyStreamingSnapshotReplay } from './replay'
import { StreamingIntradayMarketDataLive } from './service'
import type { StreamingSnapshotManifest } from './snapshot'

test('native replay retains immutable identity proof without changing output or hashes', () => {
  const { snapshot, rows } = streamingFixture({ AAPL: 0.01, AMZN: 0.02 })
  const replay = Result.getOrThrow(reproduceStreamingSnapshot(snapshot.manifest, rows))
  expect(replay).toEqual(snapshot)
  expect(Result.getOrThrow(canonicalHashV1Result(replay.manifest))).toBe(
    Result.getOrThrow(canonicalHashV1Result(snapshot.manifest)),
  )
  expect(hasStreamingReproductionProof(snapshot)).toBe(false)
  expect(hasStreamingReproductionProof(replay)).toBe(true)
  // Exact identity proves the second native reproduction was not performed.
  expect(Result.getOrThrow(verifyStreamingSnapshotReplay(replay))).toBe(replay)
})

test('proof graph is deeply frozen and detached from caller-owned aliases', () => {
  const { snapshot, rows } = streamingFixture({ AAPL: 0.01, AMZN: 0.02 })
  const manifest = structuredClone(snapshot.manifest)
  const replay = Result.getOrThrow(reproduceStreamingSnapshot(manifest, rows))
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    expect(Object.isFrozen(value)).toBe(true)
    for (const key of Reflect.ownKeys(value)) visit(Object.getOwnPropertyDescriptor(value, key)?.value)
  }
  visit(replay)
  expect(replay.manifest).not.toBe(snapshot.manifest)
  expect(replay.manifest.streaming).not.toBe(snapshot.manifest.streaming)
  expect(replay.bars[0]).not.toBe(snapshot.bars[0])
  expect(Object.isFrozen(manifest)).toBe(false)
  expect(Reflect.set(replay.manifest, 'contentHash', 'forged')).toBe(false)
  expect(Reflect.set(replay.bars, '0', {})).toBe(false)
  expect(Reflect.set(replay.manifest.streaming, 'positions', [])).toBe(false)
  expect(Reflect.set(manifest, 'contentHash', 'changed-caller-alias')).toBe(true)
  expect(Result.getOrThrow(verifyStreamingSnapshotReplay(replay))).toBe(replay)
})

test('shallow copies and serialized clones cannot forge proof and still require native replay', () => {
  const { snapshot, rows } = streamingFixture({ AAPL: 0.01, AMZN: 0.02 })
  const replay = Result.getOrThrow(reproduceStreamingSnapshot(snapshot.manifest, rows))
  for (const clone of [{ ...replay }, structuredClone(replay)]) {
    expect(hasStreamingReproductionProof(clone)).toBe(false)
    const checked = Result.getOrThrow(verifyStreamingSnapshotReplay(clone))
    expect(checked).not.toBe(clone)
    expect(checked).toEqual(replay)
    expect(hasStreamingReproductionProof(checked)).toBe(true)
  }
  const forged = { ...replay, quotes: [] }
  expect(hasStreamingReproductionProof(forged)).toBe(false)
  expect(Result.isFailure(verifyStreamingSnapshotReplay(forged))).toBe(true)
})

test('foreign hashes, invalid retained rows and failed reproduction never acquire proof', () => {
  const { snapshot, rows } = streamingFixture({ AAPL: 0.01, AMZN: 0.02 })
  const other = streamingFixture({ AAPL: -0.01, AMZN: 0.02 })
  const foreign = { ...snapshot, manifest: other.snapshot.manifest }
  expect(hasStreamingReproductionProof(foreign)).toBe(false)
  expect(Result.isFailure(verifyStreamingSnapshotReplay(foreign))).toBe(true)
  expect(Result.isFailure(reproduceStreamingSnapshot(snapshot.manifest, { ...rows, quotes: [] }))).toBe(true)
  expect(hasStreamingReproductionProof(snapshot)).toBe(false)
  const oldContract = {
    ...snapshot,
    manifest: { ...snapshot.manifest, schemaVersion: 'bayn.streaming-market-snapshot.v0' },
  }
  expect(hasStreamingReproductionProof(oldContract as typeof snapshot)).toBe(false)
  expect(Result.isFailure(verifyStreamingSnapshotReplay(oldContract as typeof snapshot))).toBe(true)
})

test('real reference service still requires an observed or exact durable source after proof reuse', async () => {
  const fixture = streamingFixture({ AAPL: 0.01, AMZN: 0.02 })
  const replay = Result.getOrThrow(reproduceStreamingSnapshot(fixture.snapshot.manifest, fixture.rows))
  let durable: StreamingSnapshotManifest | undefined
  let reads = 0
  // Only the SQL boundary is replaced. The real service and reference decoder run.
  const sql = Object.assign(
    (_strings: TemplateStringsArray, ...parameters: readonly unknown[]) =>
      Effect.sync(() => {
        reads += 1
        const [snapshotId, contentHash, observedAt, manifest] = parameters
        return [
          {
            matches:
              durable !== undefined &&
              snapshotId === durable.snapshotId &&
              contentHash === durable.contentHash &&
              observedAt === durable.observedAt &&
              JSON.stringify(manifest) === JSON.stringify(durable),
          },
        ]
      }),
    { json: (value: unknown) => value },
  ) as unknown as PgClient.PgClient
  const live = StreamingIntradayMarketDataLive.pipe(
    Layer.provide(Layer.succeed(PgClient.PgClient, sql)),
    Layer.provide(
      Layer.succeed(KafkaMarketProjection, {
        read: Effect.succeed(fixture.cut),
        readForLiquidation: Effect.succeed(fixture.cut),
        status: Effect.succeed({ epoch: 'fixture-epoch', ready: true, sequence: fixture.cut.projection.sequence }),
      }),
    ),
  )
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* IntradayMarketData
      const missing = yield* Effect.exit(service.verifyReference(replay))
      durable = replay.manifest
      const exact = yield* service.verifyReference(replay)
      durable = { ...replay.manifest, contentHash: 'f'.repeat(64) }
      const different = yield* Effect.exit(service.verifyReference(replay))
      return { missing, exact, different }
    }).pipe(Effect.provide(live)),
  )
  expect(hasStreamingReproductionProof(replay)).toBe(true)
  expect(Exit.isFailure(result.missing)).toBe(true)
  expect(result.exact.manifest).toEqual(replay.manifest)
  expect(Exit.isFailure(result.different)).toBe(true)
  expect(reads).toBe(3)
})

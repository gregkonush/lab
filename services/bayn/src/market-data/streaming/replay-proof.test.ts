import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { canonicalHashV1Result } from '../../hash'
import { streamingFixture } from '../../testing/streaming-market-fixture'
import { hasStreamingReproductionProof, reproduceStreamingSnapshot, verifyStreamingSnapshotReplay } from './replay'

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
    for (const child of Object.values(value)) visit(child)
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

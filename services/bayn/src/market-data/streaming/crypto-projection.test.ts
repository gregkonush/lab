import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { cryptoMarketFixture } from '../../testing/crypto-market-fixture'
import { reproduceStreamingSnapshot } from './replay'

test('native candidate and benchmark features reproduce a Sunday snapshot crossing midnight through the shared projection', () => {
  const { snapshot, rows, fixtures, cut } = cryptoMarketFixture()
  expect([...cut.projection.rejections.values()].flat()).toEqual([])
  expect(snapshot.bars).toHaveLength(60)
  expect(snapshot.bars[0]?.volume).toBe(0.000000001)
  expect(snapshot.manifest.streaming.features.map((receipt) => receipt.value.featureId).sort()).toEqual(
    fixtures
      .filter((fixture) => snapshot.manifest.symbols.includes(fixture.feature.material.symbol))
      .map((fixture) => fixture.feature.featureId)
      .sort(),
  )
  const reproduced = Result.getOrThrow(reproduceStreamingSnapshot(snapshot.manifest, rows))
  expect(reproduced.manifest.snapshotId).toBe(snapshot.manifest.snapshotId)
})

test('crypto replay rejects a normalized price substituted beneath an unchanged native payload', () => {
  const { snapshot, rows } = cryptoMarketFixture()
  const changed = {
    ...rows,
    bars: rows.bars.map((row, index) => {
      if (typeof row !== 'object' || row === null) throw new Error('Expected a retained bar object')
      return index === 0 ? { ...row, open: 102, high: 102, low: 102, close: 102, vwap: 102 } : row
    }),
  }
  expect(Result.isFailure(reproduceStreamingSnapshot(snapshot.manifest, changed))).toBe(true)
})

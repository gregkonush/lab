import { expect, test } from 'bun:test'
import { jevRequestForSnapshot } from '../../jev/native.test-support'
import { jevStalePricingSymbols } from '../../jev/trading-signals'
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

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const) {
  test(`${symbol} admits fresh quotes and actual window trades for both continuous candidate and benchmark`, () => {
    const { snapshot, rows } = cryptoMarketFixture(symbol, { tradeLagMs: 60_000 })
    expect(jevStalePricingSymbols(snapshot)).toEqual([])
    const state = JSON.parse(Result.getOrThrow(jevRequestForSnapshot(snapshot, symbol)).body).state
    expect(state.candidate.quote.ageMs).toBe(1000)
    expect(state.candidate.latestTrade.ageMs).toBe(61000)
    expect(state.benchmark.latestTrade.ageMs).toBe(61000)
    expect(reproduceStreamingSnapshot(snapshot.manifest, rows)).toMatchObject({ _tag: 'Success' })
    expect(() => cryptoMarketFixture(symbol, { tradeLagMs: 31 * 60_000 })).toThrow()
    expect(() => cryptoMarketFixture(symbol, { quoteLagMs: 10_001 })).toThrow()
    expect(() => cryptoMarketFixture(symbol, { tradeLagMs: -10_000 })).toThrow()
  })
}

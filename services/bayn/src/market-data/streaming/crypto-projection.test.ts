import { expect, test } from 'bun:test'
import { jevRequestForSnapshot } from '../../jev/native.test-support'
import { jevStalePricingSymbols } from '../../jev/trading-signals'
import { Result } from 'effect'

import { cryptoMarketFixture } from '../../testing/crypto-market-fixture'
import { reproduceStreamingSnapshot } from './replay'
import { latestQuotes, persistIntradayRecordRows } from '../intraday/verification'
import { constructStreamingSnapshot } from './snapshot'

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const) {
  test(`${symbol} reproduces its native snapshot while the shared consumer also carries equity technical features`, () => {
    const { cut, query } = cryptoMarketFixture(symbol)
    const shared = {
      ...cut,
      projection: { ...cut.projection, technicalTopic: 'torghut.technical-features.v1' },
    }
    const snapshot = Result.getOrThrow(constructStreamingSnapshot(shared, query))
    const rows = Result.getOrThrow(persistIntradayRecordRows(snapshot))
    const reproduced = Result.getOrThrow(reproduceStreamingSnapshot(snapshot.manifest, rows))
    expect(reproduced.manifest.snapshotId).toBe(snapshot.manifest.snapshotId)
    expect(snapshot.manifest.streaming.technical).toBeUndefined()
    expect(snapshot.manifest.streaming.features).toHaveLength(2)
  })
}

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
  test(`${symbol} uses completed benchmark bars while retaining fresh executable candidate quotes`, () => {
    expect(() => cryptoMarketFixture(symbol, { benchmarkQuoteLagMs: 9001 })).not.toThrow()
    const { query, snapshot, rows } = cryptoMarketFixture(symbol, { benchmarkQuoteLagMs: 9000, tradeLagMs: 60_000 })
    expect(jevStalePricingSymbols(snapshot)).toEqual([])
    expect(reproduceStreamingSnapshot(snapshot.manifest, rows)).toMatchObject({ _tag: 'Success' })
    const {
      candidateSymbols: _candidates,
      benchmarkEvidencePolicy: _benchmarkPolicy,
      benchmarkSymbols: _benchmarks,
      ...requiredQuery
    } = query
    const benchmark = symbol === 'BTC/USD' ? 'ETH/USD' : 'BTC/USD'
    const staleQuotes = snapshot.quotes.map((quote) =>
      quote.symbol === benchmark
        ? { ...quote, eventAt: new Date(Date.parse(query.observedAt) - 10_001).toISOString() }
        : quote,
    )
    expect(latestQuotes(requiredQuery, staleQuotes, snapshot.trades)).toMatchObject({
      _tag: 'Failure',
      failure: { reason: 'freshness', facts: { symbol: benchmark } },
    })
  })

  test(`${symbol} requires candidate quotes and actual window trades with independent completed benchmark bars`, () => {
    const benchmark = symbol === 'BTC/USD' ? 'ETH/USD' : 'BTC/USD'
    expect(() => cryptoMarketFixture(symbol, { missingTradeSymbols: [benchmark] })).not.toThrow()
    const { snapshot, rows } = cryptoMarketFixture(symbol, { tradeLagMs: 60_000 })
    expect(jevStalePricingSymbols(snapshot)).toEqual([])
    const state = JSON.parse(Result.getOrThrow(jevRequestForSnapshot(snapshot, symbol)).body).state
    expect(state.candidate.quote.ageMs).toBe(1000)
    expect(state.candidate.latestTrade.ageMs).toBe(61000)
    expect(state.benchmark.pricingBasis).toBe('COMPLETED_BAR_CLOSE')
    expect(state.benchmark).not.toHaveProperty('latestTrade')
    expect(state.benchmark).not.toHaveProperty('quote')
    expect(reproduceStreamingSnapshot(snapshot.manifest, rows)).toMatchObject({ _tag: 'Success' })
    expect(() => cryptoMarketFixture(symbol, { tradeLagMs: 31 * 60_000 })).toThrow()
    expect(() => cryptoMarketFixture(symbol, { quoteLagMs: 10_001 })).toThrow()
    expect(() => cryptoMarketFixture(symbol, { tradeLagMs: -10_000 })).toThrow()
  })
}

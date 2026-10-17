import { expect, test } from 'bun:test'
import { Result } from 'effect'

import {
  EquityScreenSignal,
  equityScreenCandidates,
  indexEquityScreenBars,
  runEquityEdgeScreen,
  type EquityScreenBar,
  type EquityScreenPolicy,
} from './equity-edge-screen'

const openAt = Date.parse('2026-09-01T13:30:00Z')
const day = { date: '2026-09-01', openAt, closeAt: openAt + 390 * 60_000 }
const policy: EquityScreenPolicy = { signal: EquityScreenSignal.Momentum, holdingMinutes: 15, adverseBpsPerSide: 10 }
const fixture = (): EquityScreenBar[] =>
  ['AAPL', 'SPY'].flatMap((symbol) =>
    Array.from({ length: 390 }, (_, i) => {
      const price = 100 + (symbol === 'AAPL' ? i * 0.01 : 0)
      return {
        symbol,
        at: openAt + i * 60_000,
        open: price,
        close: price,
        high: price + 0.02,
        low: price - 0.02,
        volume: 1000,
        vwap: price,
      }
    }),
  )
const unwrap = <A, E>(value: Result.Result<A, E>): A => {
  if (Result.isFailure(value)) throw value.failure
  return value.success
}
const run = (bars: readonly EquityScreenBar[], selected = policy) =>
  unwrap(runEquityEdgeScreen(unwrap(indexEquityScreenBars(bars)), ['AAPL', 'SPY'], [day], day.date, day.date, selected))

test('cash days remain in the denominator without invented profit or cost qualification', () => {
  const result = run(fixture().filter((bar) => bar.symbol === 'SPY'))
  expect(result.status).toBe('COMPLETED')
  expect(result.sessions).toHaveLength(1)
  expect(result.trades).toHaveLength(0)
  expect(result.executionNetPnlMicros).toBe('0')
  expect(result.allInProfit).toBeNull()
  expect(result.profitabilityQualified).toBe(false)
})

test('entry follows closed evidence and one full minute of decision latency; trades never overlap', () => {
  const result = run(fixture())
  expect(result.status).toBe('COMPLETED')
  expect(result.trades.length).toBeGreaterThan(1)
  const first = result.trades[0]
  expect(first?.signalAt).toBe(openAt + 30 * 60_000)
  expect(first?.entryAt).toBe(openAt + 31 * 60_000)
  expect(first?.exitAt).toBe(openAt + 46 * 60_000)
  for (let i = 1; i < result.trades.length; i++) {
    const previous = result.trades[i - 1]
    const current = result.trades[i]
    expect(previous).toBeDefined()
    expect(current).toBeDefined()
    if (previous && current) expect(current.signalAt).toBeGreaterThan(previous.exitAt)
  }
})

test('future bars cannot change the contemporaneous ranking', () => {
  const bars = fixture()
  const at = openAt + 30 * 60_000
  const rank = (input: readonly EquityScreenBar[]) =>
    equityScreenCandidates(
      unwrap(indexEquityScreenBars(input)),
      ['AAPL', 'SPY'],
      [day],
      0,
      at,
      EquityScreenSignal.Momentum,
    )
  const mutated = bars.map((bar) =>
    bar.at < at
      ? bar
      : { ...bar, open: bar.open * 2, high: bar.high * 2, low: bar.low * 2, close: bar.close * 2, vwap: bar.vwap * 2 },
  )
  expect(rank(mutated)).toEqual(rank(bars))
})

test('duplicate bars fail; row order cannot change results', () => {
  const bars = fixture()
  expect(run([...bars].reverse())).toEqual(run(bars))
  const first = bars[0]
  if (first === undefined) throw new Error('fixture empty')
  expect(Result.isFailure(indexEquityScreenBars([...bars, first]))).toBe(true)
})

test('missing exit evidence produces an incomplete path, not zero profit or a fabricated liquidation', () => {
  const bars = fixture().filter((bar) => bar.symbol !== 'AAPL' || bar.at < openAt + 46 * 60_000)
  const result = run(bars)
  expect(result.status).toBe('INCOMPLETE')
  expect(result.executionNetPnlMicros).toBeNull()
  expect(result.incomplete?.reason).toBe('MISSING_EXIT_BAR')
})

test('gaps through a stop are charged at the later available price, not clipped to the stop', () => {
  const bars = fixture().map((bar) =>
    bar.symbol === 'AAPL' && bar.at >= openAt + 33 * 60_000
      ? { ...bar, open: 98, high: 98.02, low: 97.98, close: 98, vwap: 98 }
      : bar,
  )
  const first = run(bars).trades[0]
  expect(first?.exitReason).toBe('STOP')
  expect(Number(first?.exitPriceMicros)).toBeLessThan(98_000_000)
  expect(Number(first?.executionNetPnlMicros)).toBeLessThan(-400_000_000)
})

test('stress execution adds costs instead of relabeling base fills as stress', () => {
  const base = run(fixture()).trades[0]
  const stress = run(fixture(), { ...policy, adverseBpsPerSide: 20 }).trades[0]
  expect(Number(stress?.entryPriceMicros)).toBeGreaterThan(Number(base?.entryPriceMicros))
  expect(Number(stress?.exitPriceMicros)).toBeLessThan(Number(base?.exitPriceMicros))
  expect(Number(stress?.executionNetPnlMicros)).toBeLessThan(Number(base?.executionNetPnlMicros))
})

test('native fees are retained separately from gross P&L', () => {
  for (const trade of run(fixture()).trades) {
    expect(BigInt(trade.feesMicros)).toBeGreaterThan(0n)
    expect(BigInt(trade.executionNetPnlMicros)).toBe(BigInt(trade.grossPnlMicros) - BigInt(trade.feesMicros))
    expect(BigInt(trade.entryPriceMicros) * BigInt(trade.shares)).toBeLessThanOrEqual(20_000_000_000n)
  }
})

test('position size is fixed from completed signal evidence, not a favorable future opening price', () => {
  const original = fixture()
  const cheaperFuture = original.map((bar) =>
    bar.symbol === 'AAPL' && bar.at >= openAt + 31 * 60_000
      ? {
          ...bar,
          open: bar.open * 0.99,
          high: bar.high * 0.99,
          low: bar.low * 0.99,
          close: bar.close * 0.99,
          vwap: bar.vwap * 0.99,
        }
      : bar,
  )
  expect(run(cheaperFuture).trades[0]?.shares).toBe(run(original).trades[0]?.shares)
})

test('empty periods have no numeric result and missing position marks remain explicit', () => {
  const index = unwrap(indexEquityScreenBars(fixture()))
  const empty = unwrap(runEquityEdgeScreen(index, ['AAPL', 'SPY'], [day], '2026-09-02', '2026-09-03', policy))
  expect(empty.status).toBe('INCOMPLETE')
  expect(empty.executionNetPnlMicros).toBeNull()
  const missingMark = run(fixture().filter((bar) => bar.symbol !== 'AAPL' || bar.at !== openAt + 35 * 60_000))
  expect(missingMark.unknownMarkedMinutes).toBeGreaterThan(0)
  expect(missingMark.markedDrawdownCoverage).toBe('OBSERVED_BAR_CLOSES_ONLY')
})

test('opening-volume selection cannot use fewer than fourteen prior sessions', () => {
  const index = unwrap(indexEquityScreenBars(fixture()))
  expect(
    equityScreenCandidates(index, ['AAPL', 'SPY'], [day], 0, openAt + 30 * 60_000, EquityScreenSignal.OpeningRange),
  ).toEqual([])
})

test('early opening-range screening uses only prior opening volume and admits at most one daily position', () => {
  const days = Array.from({ length: 15 }, (_, i) => ({
    date: new Date(openAt + i * 86_400_000).toISOString().slice(0, 10),
    openAt: openAt + i * 86_400_000,
    closeAt: day.closeAt + i * 86_400_000,
  }))
  const bars = days.flatMap((_d, i) =>
    fixture().map((bar) => ({ ...bar, at: bar.at + i * 86_400_000, volume: i === 14 ? 2000 : 1000 })),
  )
  const lastDay = days.at(-1)
  if (lastDay === undefined) throw new Error('fixture empty')
  const index = unwrap(indexEquityScreenBars(bars))
  const result = unwrap(
    runEquityEdgeScreen(index, ['AAPL', 'SPY'], days, lastDay.date, lastDay.date, {
      ...policy,
      signal: EquityScreenSignal.EarlyOpeningRange,
    }),
  )
  expect(result.status).toBe('COMPLETED')
  expect(result.trades).toHaveLength(1)
  expect(result.trades[0]?.signalAt).toBeLessThan(lastDay.openAt + 30 * 60_000)
  const at = lastDay.openAt + 10 * 60_000
  expect(
    equityScreenCandidates(index, ['AAPL', 'SPY'], days, 14, at, EquityScreenSignal.EarlyOpeningRange)[0]?.score,
  ).toBe(2)
})

test('volatility sizing reduces allocated capital rather than increasing risk for a wider stop', () => {
  const bars = fixture().map((bar, i) => {
    if (bar.symbol !== 'AAPL') return bar
    const price = bar.close + (i % 2 ? -0.3 : 0.3)
    return { ...bar, open: price, close: price, high: price + 0.02, low: price - 0.02, vwap: price }
  })
  const result = run(bars, { ...policy, volatilityRisk: true })
  expect(result.trades.length).toBeGreaterThan(0)
  const first = result.trades[0]
  if (first === undefined) throw new Error('fixture did not enter')
  expect(BigInt(first.entryPriceMicros) * BigInt(first.shares)).toBeLessThanOrEqual(5_000_000_000n)
})

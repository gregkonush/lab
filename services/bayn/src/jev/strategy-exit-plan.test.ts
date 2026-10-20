import { expect, test } from 'bun:test'
import { Result, Schema } from 'effect'
import fc from 'fast-check'

import { checkProperty } from '../testing/property-test-support'
import { deriveJevStrategyExitPlan, JevStrategyExitPlanSchema } from './strategy-exit-plan'

const end = '2026-10-19T15:00:00.000Z'
const input = (symbol = 'AAPL', low = 99.8, high = 100.3) => ({
  symbol,
  bars: Array.from({ length: 15 }, (_, i) => ({
    symbol,
    eventAt: new Date(Date.parse(end) - (15 - i) * 60_000).toISOString(),
    final: true,
    open: 100,
    high,
    low,
    close: 100,
  })),
  sourceEndAt: end,
  maximumEntryPriceMicros: 100_200_000n,
  maximumHoldingMinutes: 15,
  maximumStopBps: 50,
  stopLimitSlippageBps: 10,
})

test('each setup binds different absolute stop and profit levels before any fill', () => {
  const first = Result.getOrThrow(deriveJevStrategyExitPlan(input()))
  const second = Result.getOrThrow(deriveJevStrategyExitPlan(input('AAPL', 99.9, 100.5)))
  expect(first._tag).toBe('Planned')
  expect(second._tag).toBe('Planned')
  if (first._tag !== 'Planned' || second._tag !== 'Planned') throw new Error('Expected source-backed levels')
  expect(first.plan.stopPriceMicros).toBe('99790000')
  expect(first.plan.profitLimitPriceMicros).toBe('100700000')
  expect(second.plan.stopPriceMicros).toBe('99890000')
  expect(second.plan.profitLimitPriceMicros).toBe('100800000')
  expect(first.plan.sourceStartAt).toBe('2026-10-19T14:45:00.000Z')
  expect(Schema.is(JevStrategyExitPlanSchema)(first.plan)).toBe(true)
})

test.each(['AAPL', 'BTC/USD', 'ETH/USD', 'SOL/USD'])(
  '%s never widens the account risk bound to fit a distant structural stop',
  (symbol) => {
    expect(Result.getOrThrow(deriveJevStrategyExitPlan(input(symbol, 98, 101)))).toEqual({
      _tag: 'Excluded',
      reason: 'STOP_RISK',
    })
  },
)

test('missing, duplicate, unfinished and future bars cannot produce a pre-entry plan', () => {
  const base = input()
  const first = base.bars[0]
  if (first === undefined) throw new Error('Expected source bar')
  expect(Result.getOrThrow(deriveJevStrategyExitPlan({ ...base, bars: base.bars.slice(1) }))).toEqual({
    _tag: 'Excluded',
    reason: 'INSUFFICIENT_EXIT_EVIDENCE',
  })
  for (const bars of [
    [...base.bars.slice(1), base.bars[1] ?? first],
    base.bars.map((bar, i) => (i === 0 ? { ...bar, final: false } : bar)),
    [...base.bars, { ...first, eventAt: end }],
    base.bars.map((bar, i) => (i === 0 ? { ...bar, low: Number.NaN } : bar)),
  ]) {
    expect(Result.isFailure(deriveJevStrategyExitPlan({ ...base, bars }))).toBe(true)
  }
})

test('fine source precision remains conservative at executable equity ticks', () => {
  const result = Result.getOrThrow(deriveJevStrategyExitPlan(input('AAPL', 99.800000000012, 100.300000000017)))
  if (result._tag !== 'Planned') throw new Error('Expected source-backed plan')
  expect(result.plan.stopPriceMicros).toBe('99790000')
  expect(BigInt(result.plan.profitLimitPriceMicros)).toBeGreaterThanOrEqual(100_700_000n)
})

test('invalid parameters fail instead of silently becoming a default policy', () => {
  for (const maximumHoldingMinutes of [0, 1.5, 61, Number.NaN])
    expect(Result.isFailure(deriveJevStrategyExitPlan({ ...input(), maximumHoldingMinutes }))).toBe(true)
  for (const maximumStopBps of [0, 501, Number.POSITIVE_INFINITY])
    expect(Result.isFailure(deriveJevStrategyExitPlan({ ...input(), maximumStopBps }))).toBe(true)
  for (const stopLimitSlippageBps of [-1, 10_000, 0.5])
    expect(Result.isFailure(deriveJevStrategyExitPlan({ ...input(), stopLimitSlippageBps }))).toBe(true)
})

test('the durable codec rejects inverted prices and a substituted source horizon', () => {
  const result = Result.getOrThrow(deriveJevStrategyExitPlan(input()))
  if (result._tag !== 'Planned') throw new Error('Expected source-backed plan')
  for (const change of [
    { stopPriceMicros: result.plan.maximumEntryPriceMicros },
    { stopLimitPriceMicros: result.plan.maximumEntryPriceMicros },
    { profitLimitPriceMicros: result.plan.stopPriceMicros },
    { sourceEndAt: '2026-10-19T15:01:00.000Z' },
  ])
    expect(Schema.is(JevStrategyExitPlanSchema)({ ...result.plan, ...change })).toBe(false)
})

test('property: every admitted plan preserves stop risk and conservative price ordering', () => {
  checkProperty(
    'strategy-bound-exit-levels',
    fc.property(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 100 }), (lowCents, highCents) => {
      const value = Result.getOrThrow(
        deriveJevStrategyExitPlan(input('AAPL', 100 - lowCents / 100, 100 + highCents / 100)),
      )
      if (value._tag !== 'Planned') return
      const entry = BigInt(value.plan.maximumEntryPriceMicros)
      const stop = BigInt(value.plan.stopPriceMicros)
      expect((entry - stop) * 10_000n).toBeLessThanOrEqual(entry * 50n)
      expect(BigInt(value.plan.stopLimitPriceMicros)).toBeLessThanOrEqual(stop)
      expect(BigInt(value.plan.profitLimitPriceMicros)).toBeGreaterThan(entry)
      expect(stop % 10_000n).toBe(0n)
      expect(BigInt(value.plan.profitLimitPriceMicros) % 10_000n).toBe(0n)
    }),
  )
})

import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { nativeJevFixture } from './native.test-support'
import { makeJevTradingSignalRequest } from './trading-signals'
import { jevEntryProbability } from './trade-plan-choices'

test('rounded plan probabilities retain bounded aggregate research values without modifying raw answers', () => {
  const rounded = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`plan_${index}`, 0.063]))
  expect(jevEntryProbability({ ...rounded, wait: 0, avoid: 0 })).toBe(1)
  expect(rounded['plan_0']).toBe(0.063)
  expect(jevEntryProbability({ plan_0: 0.4, plan_1: 0.2, wait: 0.3, avoid: 0.1 })).toBeCloseTo(0.6)
  expect(jevEntryProbability({ wait: 0.7, avoid: 0.3 })).toBe(0)
})

test('a fresh high still offers complete cost-valid hypothetical plans and explicit abstention', () => {
  const fixture = nativeJevFixture(undefined, undefined, undefined, undefined, undefined, undefined, undefined, false)
  const prepared = Result.getOrThrow(makeJevTradingSignalRequest(fixture.observation.payload, 'AAPL'))
  expect(Object.keys(prepared.request.questions)).toEqual(['action'])
  const action = prepared.request.questions['action']
  if (action?.type !== 'choice') throw new Error('Expected a plan choice')
  expect(action.criteria).toHaveProperty('wait')
  expect(action.criteria).toHaveProperty('avoid')
  const plans = Object.entries(action.criteria).filter(([name]) => name.startsWith('plan_'))
  expect(plans.length).toBeGreaterThan(1)
  expect(plans.length).toBeLessThanOrEqual(16)
  const state = JSON.parse(prepared.body).state
  for (const [, value] of plans) {
    expect(value).toHaveProperty('plan')
    expect(value).toHaveProperty('priceBasis', 'HYPOTHETICAL_ORDER_PRICES')
    expect(value).toHaveProperty('plan.levels.symbol', 'AAPL')
    const serialized = JSON.parse(JSON.stringify(value))
    expect(BigInt(serialized.plan.estimatedTargetNetMicros)).toBeGreaterThan(
      BigInt(serialized.plan.acquisitionCostMicros),
    )
    expect(Number(serialized.plan.levels.profitLimitPriceMicros) / 1_000_000).toBeGreaterThan(
      state.entryEconomics.breakEvenExitBidUsd,
    )
  }
})

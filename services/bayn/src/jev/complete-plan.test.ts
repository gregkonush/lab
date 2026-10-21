import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { nativeJevFixture } from './native.test-support'
import { makeJevTradingSignalRequest } from './trading-signals'

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

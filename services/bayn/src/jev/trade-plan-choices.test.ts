import { expect, test } from 'bun:test'
import { Result, Schema } from 'effect'

import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { jevEntryEconomics } from './entry-economics'
import { defaultJevProtocolDocument } from './protocol'
import { JevFundedExitPlanSchema } from './strategy-exit-plan'
import { jevTradePlanQuestion } from './trade-plan-choices'

const plansForRange = (
  rangeUsd: number,
  capitalMicros = '100000000000',
  priceUsd = 100,
  symbol: 'BTC/USD' | 'ETH/USD' | 'SOL/USD' = 'ETH/USD',
) => {
  const { snapshot } = cryptoMarketFixture(symbol)
  const economics = Result.getOrThrow(
    jevEntryEconomics({
      protocol: defaultJevProtocolDocument,
      symbol,
      bidMicros: BigInt(Math.round(priceUsd * 1_000_000)),
      askMicros: BigInt(Math.round((priceUsd + 0.01) * 1_000_000)),
      capitalMicros,
    }),
  )
  if (economics === null) throw new Error('Expected funded crypto economics')
  const quote = snapshot.latestQuotes[symbol]
  if (quote === undefined) throw new Error('Expected crypto quote')
  const question = Result.getOrThrow(
    jevTradePlanQuestion({
      protocol: defaultJevProtocolDocument,
      symbol,
      economics,
      snapshot: {
        ...snapshot,
        latestQuotes: {
          ...snapshot.latestQuotes,
          [symbol]: { ...quote, bidPrice: priceUsd, askPrice: priceUsd + 0.01 },
        },
        bars: snapshot.bars.map((bar) =>
          bar.symbol === symbol
            ? { ...bar, open: priceUsd, high: priceUsd, low: priceUsd - rangeUsd, close: priceUsd }
            : bar,
        ),
      },
    }),
  )
  const plans = Object.values(question.criteria).flatMap((criterion) => {
    if (criterion === null || typeof criterion !== 'object' || Array.isArray(criterion) || !('plan' in criterion))
      return []
    return [Schema.decodeUnknownSync(JevFundedExitPlanSchema)(criterion['plan'])]
  })
  return { question, plans, economics }
}

test.each([0, 0.1, 0.25])('a %s USD observed range retains a fee-covering hypothetical plan', (range) => {
  const { plans, question, economics } = plansForRange(range)
  expect(economics.breakEvenExitBidUsd).toBeGreaterThan(100.5)
  expect(plans.length).toBeGreaterThan(0)
  expect(Object.keys(question.criteria)).toContain('wait')
  expect(Object.keys(question.criteria)).toContain('avoid')
  for (const plan of plans) {
    expect(BigInt(plan.estimatedTargetNetMicros)).toBeGreaterThan(BigInt(plan.acquisitionCostMicros))
    expect(BigInt(plan.estimatedStopNetMicros)).toBeLessThan(BigInt(plan.acquisitionCostMicros))
    expect(Number(plan.levels.profitLimitPriceMicros) / 1_000_000).toBeGreaterThanOrEqual(economics.breakEvenExitBidUsd)
    expect(plan.levels.maximumHoldingMinutes).toBe(15)
  }
})

test('a sub-unit BTC allocation has strictly positive funded proceeds despite price and cash rounding', () => {
  const { plans, economics } = plansForRange(0, '94321650000', 80_000, 'BTC/USD')
  expect(Number(economics.receivedQuantityAtoms)).toBeLessThan(1_000_000_000)
  expect(plans.length).toBeGreaterThan(0)
  for (const plan of plans)
    expect(BigInt(plan.estimatedTargetNetMicros)).toBeGreaterThan(BigInt(plan.acquisitionCostMicros))
})

test('missing allocation economics still supplies only abstention', () => {
  const { snapshot } = cryptoMarketFixture()
  const question = Result.getOrThrow(
    jevTradePlanQuestion({ snapshot, symbol: 'BTC/USD', economics: null, protocol: defaultJevProtocolDocument }),
  )
  expect(Object.keys(question.criteria).sort()).toEqual(['avoid', 'wait'])
})

test('funded targets retain their market-price anchors when position size changes', () => {
  const targetPrices = (capital: string) => {
    const { plans } = plansForRange(4, capital)
    expect(plans.length).toBeGreaterThan(0)
    for (const plan of plans) {
      expect(BigInt(plan.estimatedTargetNetMicros)).toBeGreaterThan(BigInt(plan.acquisitionCostMicros))
      expect(BigInt(plan.estimatedStopNetMicros)).toBeLessThan(BigInt(plan.acquisitionCostMicros))
    }
    return [...new Set(plans.map((plan) => plan.levels.profitLimitPriceMicros))].filter(
      (price) => Number(price) / 1_000_000 >= 101,
    )
  }
  expect(targetPrices('100000000000')).toEqual(['101000000', '102000000', '108000000'])
  expect(targetPrices('1000000000000')).toEqual(targetPrices('100000000000'))
})

import { expect, test } from 'bun:test'
import { Result, Schema } from 'effect'

import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { jevEntryEconomics } from './entry-economics'
import { defaultJevProtocolDocument } from './protocol'
import { JevFundedExitPlanSchema } from './strategy-exit-plan'
import { jevTradePlanQuestion } from './trade-plan-choices'

const plansForRange = (rangeUsd: number, capitalMicros = '100000000000') => {
  const symbol = 'ETH/USD'
  const { snapshot } = cryptoMarketFixture(symbol)
  const economics = Result.getOrThrow(
    jevEntryEconomics({
      protocol: defaultJevProtocolDocument,
      symbol,
      bidMicros: 100_000_000n,
      askMicros: 100_010_000n,
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
        latestQuotes: { ...snapshot.latestQuotes, [symbol]: { ...quote, bidPrice: 100, askPrice: 100.01 } },
        bars: snapshot.bars.map((bar) =>
          bar.symbol === symbol ? { ...bar, open: 100, high: 100, low: 100 - rangeUsd, close: 100 } : bar,
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

test.each([0, 0.1, 0.25])('a %s USD observed range cannot manufacture targets above the crypto fee floor', (range) => {
  const { plans, question, economics } = plansForRange(range)
  expect(economics.breakEvenExitBidUsd).toBeGreaterThan(100.5)
  expect(plans).toHaveLength(0)
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
    return [...new Set(plans.map((plan) => plan.levels.profitLimitPriceMicros))]
  }
  expect(targetPrices('100000000000')).toEqual(['101000000', '102000000', '104000000', '108000000'])
  expect(targetPrices('1000000000000')).toEqual(targetPrices('100000000000'))
})

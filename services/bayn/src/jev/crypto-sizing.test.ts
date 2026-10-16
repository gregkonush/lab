import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { JevBatchPlanVersion, JevCandidatePlanStatus } from './batch'
import { decideJevEntry } from './decision'
import { jevObservationForSnapshot, nativeJevBatchResult } from './native.test-support'
import { compileJevEntry } from './runtime'
import { makeJevTradingSignalBatch } from './trading-signals'

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const) {
  test(`${symbol} honors a chosen enter action and sizes from capital rather than one displayed quote`, () => {
    const { snapshot } = cryptoMarketFixture(symbol, { quoteAskSize: 0.8 })
    const observation = Result.getOrThrow(jevObservationForSnapshot(snapshot)).payload
    const batchPlan = Result.getOrThrow(
      makeJevTradingSignalBatch({
        observation,
        expiresAt: new Date(
          Date.parse(observation.observedAt) + observation.protocol.inferenceValidityMs,
        ).toISOString(),
        planVersion: JevBatchPlanVersion.V4,
      }),
    )
    const decidedAt = new Date(Date.parse(observation.observedAt) + 100).toISOString()
    const decision = Result.getOrThrow(
      decideJevEntry({
        observation,
        batchPlan,
        batchResult: nativeJevBatchResult(batchPlan, decidedAt, () => 'enter', 0.42),
        decidedAt,
      }),
    )
    expect(decision.selectedSymbols).toEqual([symbol])
    const compiled = Result.getOrThrow(compileJevEntry(decision, snapshot, snapshot))
    const quantity = BigInt(compiled.maximumBuyQuantityAtoms[symbol] ?? '0')
    const notional = (quantity * BigInt(compiled.askPriceMicros[symbol] ?? '0')) / 1_000_000_000n
    const capital = BigInt(observation.portfolio.brokerState.account.equityMicros)
    expect(notional).toBeGreaterThanOrEqual((capital * 199n) / 1000n)
    expect(notional).toBeLessThanOrEqual(capital / 5n)
  })
}

test('SOL with a 15 bps spread reaches the same native model batch as BTC and ETH', () => {
  const { snapshot } = cryptoMarketFixture('SOL/USD', { quoteSpreadBps: 15 })
  const observation = Result.getOrThrow(jevObservationForSnapshot(snapshot)).payload
  const plan = Result.getOrThrow(
    makeJevTradingSignalBatch({
      observation,
      expiresAt: new Date(Date.parse(observation.observedAt) + observation.protocol.inferenceValidityMs).toISOString(),
      planVersion: JevBatchPlanVersion.V4,
    }),
  )
  expect(plan.candidates.find((candidate) => candidate.symbol === 'SOL/USD')?.status).toBe(
    JevCandidatePlanStatus.Requested,
  )
})

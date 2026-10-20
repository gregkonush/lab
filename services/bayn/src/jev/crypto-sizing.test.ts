import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { JevBatchPlanVersion, JevCandidatePlanStatus } from './batch'
import { decideJevEntry } from './decision'
import { jevObservationForSnapshot, nativeJevBatchResult } from './native.test-support'
import { compileJevEntry } from './runtime'
import { makeJevTradingSignalBatch } from './trading-signals'

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const) {
  test(`${symbol} declines an unfunded flat-range setup before requesting a model or creating an order`, () => {
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
    expect(decision.selectedSymbols).toEqual([])
    expect(batchPlan.candidates).toMatchObject([
      { symbol, status: JevCandidatePlanStatus.Excluded, reason: 'exit-plan' },
    ])
    const compiled = Result.getOrThrow(compileJevEntry(decision, snapshot, snapshot))
    expect(compiled.maximumBuyQuantityAtoms).toEqual({})
  })
}

test('SOL within the spread limit still requires a funded structural exit plan', () => {
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
    JevCandidatePlanStatus.Excluded,
  )
})

import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { reconciledStateHash } from '../reconciliation'
import { nativeJevFixture, nativeJevBatchResult } from './native.test-support'
import { decodeJevProtocol, defaultJevProtocolDocument } from './protocol'
import { decodeJevPortfolio, JevPurpose } from './portfolio'
import { makeJevObservation } from './observation'
import { makeJevTradingSignalBatch, reproduceJevRequestFromObservation } from './trading-signals'
import { JevBatchPlanVersion, JevCandidatePlanStatus } from './batch'
import { decideJevEntry } from './decision'
import { maximumBuyQuantities, adverseQuotePrices } from '../observe-composition/intraday-market-data'

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const) {
  test(`${symbol} uses the shared Jev decision path with native signals and fractional precision on Sunday`, () => {
    const { snapshot } = cryptoMarketFixture(symbol)
    const prior = nativeJevFixture().portfolio.brokerState
    const observedAt = snapshot.manifest.observedAt
    const material = {
      account: { ...prior.account, observedAt },
      positions: [],
      orders: [],
      positionsObservedAt: observedAt,
      ordersObservedAt: observedAt,
      accountingHash: prior.accountingHash,
    }
    const hash = Result.getOrThrow(reconciledStateHash(material))
    const portfolio = Result.getOrThrow(
      decodeJevPortfolio({
        purpose: JevPurpose.Entry,
        brokerState: {
          ...material,
          unknownOrderCount: 0,
          reconciliation: { ...prior.reconciliation, expectedHash: hash, observedHash: hash, reconciledAt: observedAt },
        },
      }),
    )
    const protocol = Result.getOrThrow(decodeJevProtocol(defaultJevProtocolDocument))
    const observation = Result.getOrThrow(
      makeJevObservation({
        cycleId: 'a'.repeat(64),
        authorityGenerationHash: 'b'.repeat(64),
        protocol,
        portfolio,
        snapshot,
      }),
    ).payload
    const plan = Result.getOrThrow(
      makeJevTradingSignalBatch({
        observation,
        expiresAt: new Date(Date.parse(observedAt) + protocol.inferenceValidityMs).toISOString(),
        planVersion: JevBatchPlanVersion.V4,
      }),
    )
    const requested = plan.candidates.find((candidate) => candidate.status === JevCandidatePlanStatus.Requested)
    expect(requested?.symbol).toBe(symbol)
    if (requested?.status !== JevCandidatePlanStatus.Requested) throw new Error('Expected an eligible crypto candidate')
    const signals = JSON.parse(
      Result.getOrThrow(reproduceJevRequestFromObservation(requested.request, observation)).body,
    ).state
    expect(signals.benchmark.symbol).toBe(symbol === 'BTC/USD' ? 'ETH/USD' : 'BTC/USD')
    expect(signals.session.schedule).toBe('CONTINUOUS')
    expect(signals.session.minutesUntilClose).toBeNull()
    expect(signals.candidate.technicalAvailability).toBe('RECORDED')
    expect(Object.keys(signals.candidate.technicalIndicators)).toHaveLength(14)
    const decidedAt = new Date(Date.parse(observedAt) + 100).toISOString()
    const decision = Result.getOrThrow(
      decideJevEntry({ observation, batchPlan: plan, batchResult: nativeJevBatchResult(plan, decidedAt), decidedAt }),
    )
    expect(decision.selectedSymbols).toEqual([symbol])
    expect(Result.getOrThrow(maximumBuyQuantities(snapshot, { [symbol]: 0.2 }))[symbol]).toBe('31234567')
    expect(Result.getOrThrow(adverseQuotePrices(snapshot, [symbol]))).toEqual({
      bidPriceMicros: { [symbol]: '103123456' },
      askPriceMicros: { [symbol]: '103123457' },
    })
  })
}

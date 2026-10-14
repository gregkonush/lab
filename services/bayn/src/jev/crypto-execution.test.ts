import { CycleState } from '../cycle/model'
import { IntradaySnapshotPurpose } from '../market-data/intraday/model'
import { persistIntradayRecordRows } from '../market-data/intraday/verification'
import { constructStreamingSnapshot } from '../market-data/streaming/snapshot'
import { expect, test } from 'bun:test'
import { Effect, Result } from 'effect'

import { canonicalHashV1 } from '../hash'
import { makeStrategyProtocolHashResult } from '../contracts'
import { makeCycleExecutionPolicyFromModel } from '../cycle/construction'
import { makeIntradayCycleDraft } from '../cycle/runner/calendar-decisions'
import { makeInitialCycle } from '../cycle/store/decisions'
import { continuousMarketHours, continuousExecutionPolicy, tradingWindow } from '../market-hours'
import { bindCycleExecutionSession } from '../execution-session'
import { Authority, KillState, OrderSide, OrderType, TimeInForce, RiskOutcome } from '../execution/contracts'
import { deriveExecutionIntentPricing } from '../execution/intent-pricing'
import { BrokerMode, decodeState } from '../risk'
import { loadQuoteBoundExecutionRiskPolicy } from '../observe-composition/decision-builder'
import {
  adverseQuotePrices,
  executionMarketDataBinding,
  maximumBuyQuantities,
} from '../observe-composition/intraday-market-data'
import { buildExecutionDecision } from '../shadow-decision'
import { decodeExecutionDecisionDocument } from '../shadow-decision-contract'
import {
  planTargets,
  quoteBoundTargetPlannerInputSchemaVersion,
  intradaySnapshotReferencePricesSchemaVersion,
  TargetPlanStatus,
  type QuoteBoundTargetPlannerInput,
} from '../target-planner'
import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { jevObservationForSnapshot, nativeJevBatchResult } from './native.test-support'
import { makeJevObservation } from './observation'
import { jevBehaviorHash } from './protocol'
import { makeJevTradingSignalBatch } from './trading-signals'
import { JevBatchPlanVersion } from './batch'
import { decideJevEntry, jevPlanningTargetWeights } from './decision'

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const) {
  test(`${symbol} produces an approved durable fractional execution decision through the shared planner and risk engine`, async () => {
    const { cut, query, snapshot, rows } = cryptoMarketFixture(symbol)
    const native = Result.getOrThrow(jevObservationForSnapshot(snapshot)).payload
    const { protocol, portfolio, observedAt } = native
    const broker = portfolio.brokerState
    const { unknownOrderCount: _unknownOrderCount, ...riskBroker } = broker
    const policy = await Effect.runPromise(
      loadQuoteBoundExecutionRiskPolicy(broker.account.accountId, protocol.universe),
    )
    const executionPolicy = Result.getOrThrow(makeCycleExecutionPolicyFromModel(protocol.executionModel))
    if (executionPolicy.schemaVersion !== 'bayn.autonomous-cycle-execution-policy.v3')
      throw new Error('Expected current policy')
    const lease = Result.getOrThrow(
      tradingWindow(continuousMarketHours, observedAt, { ...continuousExecutionPolicy, sessionEntryCutoffMs: 0 }),
    )
    if (lease === null) throw new Error('Continuous market must admit a lease')
    const strategyProtocolHash = Result.getOrThrow(
      makeStrategyProtocolHashResult({
        name: 'jev',
        behaviorHash: jevBehaviorHash,
        parameterHash: canonicalHashV1(protocol),
        parameterSchemaVersion: protocol.schemaVersion,
      }),
    )
    const draft = Result.getOrThrow(
      makeIntradayCycleDraft(
        {
          cycleBindingId: 'a'.repeat(64),
          strategyName: 'jev',
          strategyProtocolHash,
          accountId: broker.account.accountId,
          executionPolicy,
        },
        continuousMarketHours,
        lease,
      ),
    )
    const cycle = { ...makeInitialCycle(draft, observedAt), state: CycleState.Active }
    const observation = Result.getOrThrow(
      makeJevObservation({
        cycleId: cycle.identity.cycleId,
        authorityGenerationHash: native.authorityGenerationHash,
        protocol,
        portfolio,
        snapshot,
      }),
    ).payload
    const batchPlan = Result.getOrThrow(
      makeJevTradingSignalBatch({
        observation,
        planVersion: JevBatchPlanVersion.V4,
        expiresAt: new Date(Date.parse(observedAt) + protocol.inferenceValidityMs).toISOString(),
      }),
    )
    const decidedAt = new Date(Date.parse(observedAt) + 100).toISOString()
    const compiledDecision = Result.getOrThrow(
      decideJevEntry({ observation, batchPlan, batchResult: nativeJevBatchResult(batchPlan, decidedAt), decidedAt }),
    )
    const source = Result.getOrThrow(executionMarketDataBinding(snapshot))
    const { candidateSymbols: _candidates, candidateEvidencePolicy: _evidencePolicy, ...pricingQuery } = query
    const pricingSnapshot = Result.getOrThrow(
      constructStreamingSnapshot(cut, {
        ...pricingQuery,
        symbols: [symbol],
        purpose: IntradaySnapshotPurpose.EntryPricing,
        observedAt: decidedAt,
      }),
    )
    const market = Result.getOrThrow(executionMarketDataBinding(pricingSnapshot))
    const pricingRows = Result.getOrThrow(persistIntradayRecordRows(pricingSnapshot))
    const prices = Result.getOrThrow(adverseQuotePrices(pricingSnapshot, [symbol]))
    const reference = {
      schemaVersion: intradaySnapshotReferencePricesSchemaVersion,
      signalDate: snapshot.manifest.sessionDate,
      observedAt: decidedAt,
      snapshotId: market.snapshotId,
      snapshotContentHash: market.contentHash,
      priceReference: 'verified-adverse-quote-boundary' as const,
      priceMicros: prices.askPriceMicros,
      ...prices,
    }
    const plannerInput: QuoteBoundTargetPlannerInput = {
      schemaVersion: quoteBoundTargetPlannerInputSchemaVersion,
      strategyName: 'jev',
      cycleId: cycle.identity.cycleId,
      decisionHash: canonicalHashV1(compiledDecision),
      policyHash: canonicalHashV1(policy),
      accountId: broker.account.accountId,
      signalDate: snapshot.manifest.sessionDate,
      targetWeights: jevPlanningTargetWeights(compiledDecision),
      referencePrices: { ...reference, contentHash: canonicalHashV1(reference) },
      brokerState: broker,
      precision: protocol.executionModel.precision,
      allocationCapitalMicros: '20000000000',
      executionTerms: {
        orderType: OrderType.Limit,
        timeInForce: TimeInForce.ImmediateOrCancel,
        priceReference: 'verified-adverse-quote-boundary',
        snapshotId: market.snapshotId,
        snapshotContentHash: market.contentHash,
        maximumBuyQuantityAtoms: Result.getOrThrow(
          maximumBuyQuantities(pricingSnapshot, jevPlanningTargetWeights(compiledDecision)),
        ),
        maximumSellQuantityAtoms: { [symbol]: '31234567' },
      },
      maximumInputAgeMs: 10_000,
      submissionCutoffAt: cycle.window.submissionCutoffAt,
      observedAt: decidedAt,
    }
    const targetPlan = Result.getOrThrow(planTargets(plannerInput))
    expect(targetPlan).toMatchObject({ status: TargetPlanStatus.Planned })
    expect(targetPlan.intentTargets).toHaveLength(1)
    const executionSession = Result.getOrThrow(
      bindCycleExecutionSession({
        cycle,
        executionSessionDate: cycle.identity.executionSessionDate,
        planningBrokerState: { observedAt, contentHash: broker.reconciliation.observedHash },
        calendar: continuousMarketHours,
        executionModel: protocol.executionModel,
      }),
    )
    const authority = {
      schemaVersion: 'bayn.paper-authority.v1' as const,
      generationHash: native.authorityGenerationHash,
      maximum: Authority.Execution,
      effective: Authority.Execution,
      kill: KillState.Clear,
      version: 1,
      updatedAt: observedAt,
    }
    const riskContext = {
      authority,
      authorityObservedAt: observedAt,
      unknownMutationCount: 0,
      dailyTradedNotionalMicros: '0',
      dayStartEquityMicros: broker.account.equityMicros,
      peakEquityMicros: broker.account.equityMicros,
    }
    const riskInputs = await Effect.runPromise(
      Effect.forEach(targetPlan.intentTargets, (target) =>
        Effect.gen(function* () {
          const planned = targetPlan.targets.find((item) => item.symbol === target.symbol)
          if (planned === undefined) throw new Error('Missing planned target')
          const pricing = Result.getOrThrow(
            deriveExecutionIntentPricing({
              symbol,
              side: target.side,
              orderType: target.orderType,
              timeInForce: target.timeInForce,
              quantityAtoms: BigInt(target.quantityAtoms),
              referencePriceMicros: BigInt(planned.referencePriceMicros),
              executionModel: protocol.executionModel,
              limitSlippageBps: 10n,
            }),
          )
          return {
            symbol,
            notionalLimitMicros: pricing.notionalLimitMicros.toString(),
            state: yield* decodeState({
              schemaVersion: 'bayn.paper-risk-state.v2',
              brokerMode: BrokerMode.Execution,
              ...riskBroker,
              ...riskContext,
              marketDataSymbol: symbol,
              marketDataHash: market.contentHash,
              executionMarketDataHash: market.contentHash,
              referencePriceMicros: planned.referencePriceMicros,
              expectedExecutionPriceMicros: pricing.expectedExecutionPriceMicros.toString(),
              marketDataObservedAt: decidedAt,
              entryQuote: { eventAt: pricingSnapshot.latestQuotes[symbol]?.eventAt, maximumAgeMs: 10_000 },
              executionSession,
              reservedBuyingPowerMicros: '0',
              evaluatedAt: decidedAt,
            }),
          }
        }),
      ),
    )
    const document = await Effect.runPromise(
      buildExecutionDecision({
        cycle,
        compiledDecision,
        plannerInput,
        targetPlan,
        policy,
        riskInputs,
        authorityGenerationHash: native.authorityGenerationHash,
        riskContext,
        entryLimitSlippageBps: 10,
        executionSession,
        snapshot: { snapshotId: source.snapshotId, contentHash: source.contentHash, finalizedAt: observedAt },
        decisionMarketData: source,
        executionMarketData: market,
        decisionMarketDataRows: rows,
        executionMarketDataRows: pricingRows,
      }),
    )
    expect(document.dispatchable).toBe(true)
    expect(document.targetPlan.intentTargets[0]).toMatchObject({
      symbol,
      side: OrderSide.Buy,
      quantityAtoms: '31234567',
    })
    expect(document.deltaRisk[0]?.evaluation.decision.outcome).toBe(RiskOutcome.Approved)
    expect(Result.isSuccess(decodeExecutionDecisionDocument(document))).toBe(true)
  })
}

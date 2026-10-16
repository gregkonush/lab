import { maximumAllocatedBuyQuantities } from './entry-sizing'
import { CycleState } from '../cycle/model'
import { IntradaySnapshotPurpose } from '../market-data/intraday/model'
import { persistIntradayRecordRows } from '../market-data/intraday/verification'
import { constructStreamingSnapshot } from '../market-data/streaming/snapshot'
import { expect, test } from 'bun:test'
import { Effect, Result, Schema } from 'effect'
import { TestClock } from 'effect/testing'

import { canonicalHashV1 } from '../hash'
import { reconciledStateHash } from '../reconciliation'
import { makeStrategyProtocolHashResult } from '../contracts'
import { makeCycleExecutionPolicyFromModel } from '../cycle/construction'
import { makeIntradayCycleDraft } from '../cycle/runner/calendar-decisions'
import { makeInitialCycle } from '../cycle/store/decisions'
import { continuousMarketHours, continuousExecutionPolicy, tradingWindow } from '../market-hours'
import { bindCycleExecutionSession } from '../execution-session'
import { Authority, KillState, OrderSide, OrderType, TimeInForce, RiskOutcome } from '../execution/contracts'
import { deriveExecutionIntentPricing } from '../execution/intent-pricing'
import { BrokerMode, decodeState } from '../risk'
import {
  buildClosingExecutionCycleDecision,
  loadQuoteBoundExecutionRiskPolicy,
} from '../observe-composition/decision-builder'
import { fixtureRuntime } from '../testing/runtime-fixtures'
import { accountTradingDate } from '../time'
import { IsoDateSchema } from '../schemas'
import { adverseQuotePrices, executionMarketDataBinding } from '../observe-composition/intraday-market-data'
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
  test.each([false, true])(`${symbol} shared lifecycle with first-minute history=%s`, async (firstMinute) => {
    const { cut, query, snapshot, rows } = cryptoMarketFixture(symbol, { firstMinute })
    expect(snapshot.bars.filter((bar) => bar.symbol === symbol)).toHaveLength(firstMinute ? 1 : 30)
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
          maximumAllocatedBuyQuantities({
            askPriceMicros: prices.askPriceMicros,
            targetWeights: jevPlanningTargetWeights(compiledDecision),
            capitalMicros: broker.account.equityMicros,
            precision: protocol.executionModel.precision,
          }),
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
    // A native coin fee can leave a quantity that is not a multiple of a micro-unit.
    const heldQuantity = '31234566'
    expect(protocol.executionModel.precision.quantityIncrementAtoms).toBe('1')
    const closeMaterial = {
      ...broker,
      positions: [
        {
          schemaVersion: 'bayn.position.v2' as const,
          accountId: broker.account.accountId,
          symbol,
          quantityAtoms: heldQuantity,
          averageEntryPriceMicros: '100000000',
          costBasisMicros: '3123457',
          marketPriceMicros: '103123457',
          marketValueMicros: '3221044',
          unrealizedPnlMicros: '97587',
          observedAt,
        },
      ],
      positionsObservedAt: observedAt,
    }
    const closeHash = Result.getOrThrow(reconciledStateHash(closeMaterial))
    const closePlan = Result.getOrThrow(
      planTargets({
        ...plannerInput,
        allocationCapitalMicros: '0',
        targetWeights: { [symbol]: 0 },
        brokerState: {
          ...closeMaterial,
          reconciliation: { ...broker.reconciliation, expectedHash: closeHash, observedHash: closeHash },
        },
      }),
    )
    expect(closePlan.status).toBe(TargetPlanStatus.Planned)
    expect(closePlan.intentTargets).toMatchObject([
      {
        symbol,
        side: OrderSide.Sell,
        quantityAtoms: heldQuantity,
        orderType: OrderType.Limit,
        timeInForce: TimeInForce.ImmediateOrCancel,
      },
    ])
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
    })
    const entryNotional =
      (BigInt(document.targetPlan.intentTargets[0]?.quantityAtoms ?? '0') *
        BigInt(prices.askPriceMicros[symbol] ?? '0')) /
      1_000_000_000n
    expect(entryNotional).toBeGreaterThanOrEqual(3_990_000_000n)
    expect(entryNotional).toBeLessThanOrEqual(4_000_000_000n)
    expect(document.deltaRisk[0]?.evaluation.metrics.orderNotionalMicros).not.toBe(
      document.deltaRisk[0]?.notionalLimitMicros,
    )
    expect(document.deltaRisk[0]?.evaluation.decision.outcome).toBe(RiskOutcome.Approved)
    expect(Result.isSuccess(decodeExecutionDecisionDocument(document))).toBe(true)

    const recoveryAt = new Date(Date.parse(cycle.window.executionCloseAt) + 4 * 60 * 60_000).toISOString()
    const tradingDate = Schema.decodeUnknownSync(IsoDateSchema)(accountTradingDate(recoveryAt))
    const closeExpiresAt = new Date(Date.parse(recoveryAt) + continuousExecutionPolicy.closeRecoveryMs).toISOString()
    const recoveredBroker = {
      ...closeMaterial,
      account: { ...broker.account, observedAt: recoveryAt },
      positions: closeMaterial.positions.map((position) => ({ ...position, observedAt: recoveryAt })),
      positionsObservedAt: recoveryAt,
      ordersObservedAt: recoveryAt,
    }
    const recoveredHash = Result.getOrThrow(reconciledStateHash(recoveredBroker))
    const {
      reconciliationId: _reconciliationId,
      contentHash: _contentHash,
      ...previousReconciliation
    } = broker.reconciliation
    const reconciliationMaterial = {
      ...previousReconciliation,
      expectedHash: recoveredHash,
      observedHash: recoveredHash,
      reconciledAt: recoveryAt,
    }
    const reconciliationId = canonicalHashV1({
      schemaVersion: 'bayn.paper-reconciliation-id.v1',
      material: reconciliationMaterial,
    })
    const reconciliation = {
      ...reconciliationMaterial,
      reconciliationId,
      contentHash: canonicalHashV1({ ...reconciliationMaterial, reconciliationId }),
    }
    const close = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse(recoveryAt))
        return yield* buildClosingExecutionCycleDecision({
          input: {
            accountId: broker.account.accountId,
            authorityGenerationHash: native.authorityGenerationHash,
            pollIntervalMs: 30_000,
            reconciliationIntervalMs: 30_000,
            reconciliationPassTimeoutMs: 30_000,
            strategy: fixtureRuntime,
          },
          preparation: { executionModel: protocol.executionModel, executionPolicy, strategyProtocolHash },
          policy,
          cycle,
          entryDocument: document,
          closeExpiresAt,
          reconcile: Effect.succeed({
            report: {
              reconciliation,
              metrics: {
                brokerPollAgeMs: 0,
                oldestUnknownMutationAgeMs: 0,
                cashDifferenceMicros: '0',
                positionDifferenceMicros: '0',
                equityDifferenceMicros: '0',
                accountingExact: true,
                discrepancyCount: 0,
              },
            },
            brokerState: { ...recoveredBroker, reconciliation },
            riskContext: {
              ...riskContext,
              tradingDate,
              authority: {
                ...authority,
                effective: Authority.Observe,
                kill: KillState.Active,
                reason: 'prior execution failure',
              },
              authorityObservedAt: recoveryAt,
            },
          }),
        })
      }).pipe(Effect.provide(TestClock.layer())),
    )
    expect(close.dispatchable).toBe(true)
    expect(close.expiresAt).toBe(closeExpiresAt)
    expect(close.executionSession).toEqual(document.executionSession)
    expect(close.bindings.executionMarketData).toMatchObject({
      schemaVersion: 'bayn.reconciled-position-liquidation-binding.v1',
      positionsObservedAt: recoveryAt,
    })
    expect(close.targetPlan.intentTargets).toMatchObject([
      {
        symbol,
        side: OrderSide.Sell,
        quantityAtoms: heldQuantity,
        orderType: OrderType.Market,
        timeInForce: TimeInForce.GoodUntilCanceled,
      },
    ])
    expect(close.deltaRisk[0]?.evaluation.decision.outcome).toBe(RiskOutcome.Approved)
    expect(Result.isSuccess(decodeExecutionDecisionDocument(close))).toBe(true)
  })
}

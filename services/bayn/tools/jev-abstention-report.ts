import { readFileSync } from 'node:fs'
import { Result, Schema } from 'effect'

import { canonicalHashV1Result } from '../src/hash'
import { decideJevEntry, JevEntryTargetSchema } from '../src/jev/decision'
import { JevCandidatePlanStatus, JevCandidateResultStatus } from '../src/jev/batch'
import { JevOutcome } from '../src/jev/evidence'
import { JevFundedExitPlanSchema } from '../src/jev/strategy-exit-plan'
import { PositiveMicrosSchema, Sha256Schema, UtcInstantSchema } from '../src/schemas'
import { jevProtectiveStopCrossed } from '../src/jev/exit'
import { jevMarketForSymbol } from '../src/jev/markets'
import { replayQuoteRejection } from '../src/intraday-replay/broker-execution-evidence'
import { replayInstrument, ReplayInstrumentsSchema } from '../src/intraday-replay/execution-core'
import type { IntradayQuote } from '../src/market-data/intraday/model'
import type { ObservedMarketValue } from '../src/market-data/streaming/projection'
import { priceNumberToMicros } from '../src/strategy/execution-model/fixed-point'

const Document = Schema.Struct({
  bindings: Schema.Struct({ cycleId: Sha256Schema }),
  mode: Schema.Literal('PAPER'),
  strategyDecision: JevEntryTargetSchema,
})
const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const State = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-trading-signal-state.v15'),
  task: Schema.Struct({ horizonMinutes: Schema.Finite }),
  execution: Schema.Struct({ estimatedFeeBpsPerSide: NonNegative, estimatedRoundTripFeesBps: NonNegative }),
  entryEconomics: Schema.NullOr(
    Schema.Struct({
      requiredBidRiseBps: Schema.Finite,
      breakEvenExitBidUsd: Schema.Finite,
      estimatedEntryFeesUsd: NonNegative,
      maximumHoldingMinutes: Schema.Finite,
      maximumEntryQuoteDriftBps: NonNegative,
      maximumEntryLimitSlippageBps: NonNegative,
      operatingCostCoverage: Schema.String,
    }),
  ),
  candidate: Schema.Struct({
    quote: Schema.Struct({ bid: Schema.Finite.check(Schema.isGreaterThan(0)), ask: Schema.Finite, ageMs: NonNegative }),
    bars1m: Schema.Array(Schema.Struct({ volume: NonNegative, tradeCount: Schema.NullOr(Schema.String) })),
    priceWindow: Schema.Struct({ expectedBarCount: NonNegative, observedBarCount: NonNegative }),
    latestTrade: Schema.optionalKey(Schema.Struct({ ageMs: NonNegative })),
    minuteLogReturnVolatilityBps: Schema.NullOr(NonNegative),
  }),
})

// These are categorical choice masses, not calibrated probabilities of making money.
export const summarizeJevChoiceMass = (probabilities: Readonly<Record<string, number>>) => {
  const plans = Object.entries(probabilities)
    .filter(([key]) => key.startsWith('plan_'))
    .map(([, value]) => value)
  return {
    interpretation: 'CATEGORICAL_CHOICE_MASS_NOT_PROFIT_PROBABILITY',
    aggregatePlanMass: plans.reduce((sum, value) => sum + value, 0),
    maximumPlanMass: plans.length === 0 ? null : Math.max(...plans),
    waitMass: probabilities['wait'] ?? null,
    avoidMass: probabilities['avoid'] ?? null,
    reportedTotalMass: Object.values(probabilities).reduce((sum, value) => sum + value, 0),
  }
}

const range = (values: readonly number[]) =>
  values.length === 0 ? null : { minimum: Math.min(...values), maximum: Math.max(...values) }

export const reportJevAbstention = (input: unknown) => {
  const document = Result.getOrThrow(Schema.decodeUnknownResult(Document)(input))
  const target = document.strategyDecision
  if (document.bindings.cycleId !== target.evidence.observation.cycleId)
    throw new Error('Decision bindings identify a different cycle')
  const reproduced = Result.getOrThrow(decideJevEntry(target.evidence))
  if (Result.getOrThrow(canonicalHashV1Result(reproduced)) !== Result.getOrThrow(canonicalHashV1Result(target)))
    throw new Error('Persisted decision does not reproduce from sealed evidence')

  const candidates = target.evidence.batchPlan.candidates.map((candidate) => {
    if (candidate.status === JevCandidatePlanStatus.Excluded)
      return { symbol: candidate.symbol, status: candidate.status, reason: candidate.reason }
    const request = candidate.request.request
    const state = Result.getOrThrow(Schema.decodeUnknownResult(State)(request.state))
    const question = request.questions['action']
    if (question?.type !== 'choice') throw new Error('Expected a complete-plan choice')
    const plans = Object.entries(question.criteria)
      .filter(([key]) => key.startsWith('plan_'))
      .map(([choice, value]) => {
        const { plan } = Result.getOrThrow(
          Schema.decodeUnknownResult(Schema.Struct({ plan: JevFundedExitPlanSchema }))(value),
        )
        const acquisition = BigInt(plan.acquisitionCostMicros)
        const loss = acquisition - BigInt(plan.estimatedStopNetMicros)
        const profit = BigInt(plan.estimatedTargetNetMicros) - acquisition
        if (loss <= 0n || profit <= 0n) throw new Error('Funded plan has invalid net economics')
        return {
          choice,
          targetRiseFromBidBps:
            (Number(plan.levels.profitLimitPriceMicros) / 1_000_000 / state.candidate.quote.bid - 1) * 10_000,
          estimatedLossUsd: Number(loss) / 1_000_000,
          estimatedProfitUsd: Number(profit) / 1_000_000,
          netRewardRisk: Number(profit) / Number(loss),
        }
      })
    const result = target.evidence.batchResult.candidates.find((value) => value.symbol === candidate.symbol)
    const response =
      result?.status === JevCandidateResultStatus.Resolved && result.receipt?.outcome.status === JevOutcome.Received
        ? result.receipt.outcome.inference.response
        : null
    const answer = response?.answers['action']
    if (answer !== undefined && answer.type !== 'choice') throw new Error('Expected a choice answer')
    return {
      symbol: candidate.symbol,
      status: candidate.status,
      requestHash: candidate.request.requestHash,
      inputDefinition: state.schemaVersion,
      chosenAction: answer?.choice ?? null,
      rejection: target.entryPlanRejections[candidate.symbol] ?? null,
      choiceMass: answer === undefined ? null : summarizeJevChoiceMass(answer.probabilities),
      fundedPlanCount: plans.length,
      targetRiseFromBidBps: range(plans.map((plan) => plan.targetRiseFromBidBps)),
      netRewardRisk: range(plans.map((plan) => plan.netRewardRisk)),
      horizonMinutes: state.task.horizonMinutes,
      entryEconomics: state.entryEconomics,
      fees: state.execution,
      coverage: {
        ...state.candidate.priceWindow,
        suppliedBarCount: state.candidate.bars1m.length,
        zeroVolumeBarCount: state.candidate.bars1m.filter((bar) => bar.volume === 0).length,
        zeroTradeBarCount: state.candidate.bars1m.filter(
          (bar) => bar.tradeCount !== null && BigInt(bar.tradeCount) === 0n,
        ).length,
        unknownTradeCountBarCount: state.candidate.bars1m.filter((bar) => bar.tradeCount === null).length,
        latestTradeAgeMs: state.candidate.latestTrade?.ageMs ?? null,
        quoteAgeMs: state.candidate.quote.ageMs,
        minuteLogReturnVolatilityBps: state.candidate.minuteLogReturnVolatilityBps,
      },
      plans,
    }
  })
  return {
    schemaVersion: 'bayn.jev-abstention-report.v1',
    diagnosticOnly: true,
    modelRationaleAvailable: false,
    profitableEdgeProven: false,
    brokerExecutionProven: false,
    reproducedFromSealedEvidence: true,
    cycleId: document.bindings.cycleId,
    observedAt: target.evidence.observation.observedAt,
    protocol: target.evidence.observation.protocol.schemaVersion,
    inputDefinition: target.evidence.observation.protocol.inputDefinition,
    selectedSymbols: target.selectedSymbols,
    candidates,
  }
}

const Integer = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const JevPlanPathAssumptionsSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-plan-path-assumptions.v1'),
  decisionHash: Sha256Schema,
  sourceEvidenceSha256: Sha256Schema,
  symbol: Schema.NonEmptyString,
  choice: Schema.String.check(Schema.isPattern(/^plan_[0-9]+$/)),
  windowAnchor: Schema.Literals(['OBSERVATION', 'HYPOTHETICAL_FIRST_FILL']),
  windowStartAt: UtcInstantSchema,
  entryLatencyMs: Integer.check(Schema.isLessThanOrEqualTo(60_000)),
  quantityAtoms: PositiveMicrosSchema,
  feeMultiplierPpm: Integer.check(Schema.isGreaterThanOrEqualTo(1_000_000), Schema.isLessThanOrEqualTo(10_000_000)),
  instruments: ReplayInstrumentsSchema,
  fillAssumption: Schema.Literal('NOT_SIMULATED'),
})

/** Describes original quote deliveries, never an executed or simulated trade.
 * The caller must obtain quotes from the native arrival auditor, not reconstruct bars. */
export const reportJevPlanPath = (input: {
  readonly decisionDocument: unknown
  readonly assumptions: unknown
  readonly quotes: readonly ObservedMarketValue<IntradayQuote>[]
  readonly sourceEvidenceSha256: string
}) => {
  const abstention = reportJevAbstention(input.decisionDocument)
  const { strategyDecision: target } = Result.getOrThrow(Schema.decodeUnknownResult(Document)(input.decisionDocument))
  const assumptions = Result.getOrThrow(Schema.decodeUnknownResult(JevPlanPathAssumptionsSchema)(input.assumptions))
  const hash = (value: unknown) => Result.getOrThrow(canonicalHashV1Result(value))
  if (hash(target) !== assumptions.decisionHash || input.sourceEvidenceSha256 !== assumptions.sourceEvidenceSha256)
    throw new Error('Plan path evidence binding differs from its assumptions')
  const candidate = target.evidence.batchPlan.candidates.find((value) => value.symbol === assumptions.symbol)
  if (candidate?.status !== JevCandidatePlanStatus.Requested)
    throw new Error('Plan path requires a requested candidate')
  const question = candidate.request.request.questions['action']
  if (question?.type !== 'choice') throw new Error('Plan path requires the original complete-plan choice')
  const { plan } = Result.getOrThrow(
    Schema.decodeUnknownResult(Schema.Struct({ plan: JevFundedExitPlanSchema }))(question.criteria[assumptions.choice]),
  )
  const quantity = BigInt(assumptions.quantityAtoms)
  const instrument = Result.getOrThrow(replayInstrument(assumptions.symbol, assumptions.instruments))
  if (
    plan.levels.symbol !== assumptions.symbol ||
    quantity > BigInt(plan.maximumQuantityAtoms) ||
    quantity < instrument.minimumQuantityAtoms ||
    quantity % instrument.quantityIncrementAtoms !== 0n
  )
    throw new Error('Declared quantity or symbol violates its sealed plan and instrument')
  const observedMs = Date.parse(target.observedAt)
  const entryArrivalMs = observedMs + assumptions.entryLatencyMs
  const startMs = Date.parse(assumptions.windowStartAt)
  if (
    entryArrivalMs >= Date.parse(candidate.request.expiresAt) ||
    (assumptions.windowAnchor === 'OBSERVATION'
      ? startMs !== observedMs
      : startMs < entryArrivalMs || startMs >= Date.parse(candidate.request.expiresAt))
  )
    throw new Error('Declared clock is outside the sealed request or differs from its anchor')
  const endMs = startMs + plan.levels.maximumHoldingMinutes * 60_000
  type Crossing = { availableAtMs: number; sequence: number; recordHash: string; bidMicros: string }
  let firstTarget: Crossing | null = null
  let firstStop: Crossing | null = null
  let previousAt = -Infinity
  let previousSequence = -1
  let accepted = 0
  let inWindow = 0
  const rejected: Record<string, number> = {}
  let firstAt: number | null = null
  let lastAt: number | null = null
  let largestGapMs = 0
  for (const quote of input.quotes) {
    if (
      !Number.isSafeInteger(quote.availableAtMs) ||
      !Number.isSafeInteger(quote.sequence) ||
      quote.availableAtMs < previousAt ||
      quote.sequence <= previousSequence ||
      !Schema.is(Sha256Schema)(quote.recordHash)
    )
      throw new Error('Native quote delivery clock, sequence or identity is invalid')
    previousAt = quote.availableAtMs
    previousSequence = quote.sequence
    if (quote.value.symbol !== assumptions.symbol || quote.availableAtMs < startMs || quote.availableAtMs > endMs)
      continue
    inWindow++
    const reason = replayQuoteRejection(quote, assumptions.symbol, quote.availableAtMs, {
      ...target.evidence.observation.protocol,
      ...jevMarketForSymbol(assumptions.symbol),
    })
    if (reason !== null) {
      rejected[reason] = (rejected[reason] ?? 0) + 1
      continue
    }
    accepted++
    firstAt ??= quote.availableAtMs
    largestGapMs = Math.max(largestGapMs, quote.availableAtMs - (lastAt ?? startMs))
    lastAt = quote.availableAtMs
    const bid = Result.getOrThrow(priceNumberToMicros(quote.value.bidPrice, 'path.bid', 'DOWN'))
    const crossing = {
      availableAtMs: quote.availableAtMs,
      sequence: quote.sequence,
      recordHash: quote.recordHash,
      bidMicros: bid.toString(),
    }
    if (firstStop === null && jevProtectiveStopCrossed(bid, plan.levels)) firstStop = crossing
    if (firstTarget === null && bid >= BigInt(plan.levels.profitLimitPriceMicros)) firstTarget = crossing
  }
  largestGapMs = Math.max(largestGapMs, endMs - (lastAt ?? startMs))
  return {
    schemaVersion: 'bayn.jev-plan-path-diagnostic.v1' as const,
    diagnosticOnly: true,
    status: 'INCOMPLETE' as const,
    qualification: 'UNQUALIFIED' as const,
    actualExecutionProven: false,
    profitableEdgeProven: false,
    netEconomicPnlMicros: null,
    feeStressApplied: false,
    fillsSimulated: false,
    assumptionManifest: assumptions,
    assumptionManifestHash: hash(assumptions),
    plan,
    originalSelectedSymbols: abstention.selectedSymbols,
    hypotheticalEntryArrivalAt: new Date(entryArrivalMs).toISOString(),
    windowEndAt: new Date(endMs).toISOString(),
    firstTarget,
    firstStop,
    observedOrder:
      firstTarget === null && firstStop === null
        ? 'NO_THRESHOLD_OBSERVED'
        : firstStop === null || (firstTarget !== null && firstTarget.sequence < firstStop.sequence)
          ? 'TARGET_OBSERVED_FIRST'
          : 'STOP_OBSERVED_FIRST',
    coverage: { inWindowQuotes: inWindow, acceptedQuotes: accepted, rejected, firstAt, lastAt, largestGapMs },
    unsupported: [
      'NATIVE_GTC_AND_CONTROLLER_REPLAY',
      'ACTUAL_FIRST_FILL_AND_CAPACITY',
      'FULL_SOURCE_AND_CONTROLLER_COMPLETENESS',
      'OPERATING_COST_ALLOCATION',
    ],
  }
}

if (import.meta.main) {
  const path = process.argv[2]
  if (path === undefined) throw new Error('Usage: bun tools/jev-abstention-report.ts <private-decision.json>')
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  console.log(JSON.stringify(reportJevAbstention(raw)))
}

import { readFileSync } from 'node:fs'
import { Result, Schema } from 'effect'

import { canonicalHashV1Result } from '../src/hash'
import { decideJevEntry, JevEntryTargetSchema } from '../src/jev/decision'
import { JevCandidatePlanStatus, JevCandidateResultStatus } from '../src/jev/batch'
import { JevOutcome } from '../src/jev/evidence'
import { JevFundedExitPlanSchema } from '../src/jev/strategy-exit-plan'
import { Sha256Schema } from '../src/schemas'

const Document = Schema.Struct({
  bindings: Schema.Struct({ cycleId: Sha256Schema }),
  mode: Schema.Literal('PAPER'),
  strategyDecision: JevEntryTargetSchema,
})
const NonNegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const State = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-trading-signal-state.v16'),
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
    const setup = response?.answers['setup']
    if (answer !== undefined && answer.type !== 'choice') throw new Error('Expected a choice answer')
    if (setup !== undefined && setup.type !== 'choice') throw new Error('Expected a setup choice answer')
    return {
      symbol: candidate.symbol,
      status: candidate.status,
      requestHash: candidate.request.requestHash,
      inputDefinition: state.schemaVersion,
      chosenAction: answer?.choice ?? null,
      chosenSetup: setup?.choice ?? null,
      setupProbabilities: setup?.probabilities ?? null,
      planChoiceCondition: 'SUPPORTED_LONG_SETUP_ASSUMED',
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
    schemaVersion: 'bayn.jev-abstention-report.v2',
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

if (import.meta.main) {
  const path = process.argv[2]
  if (path === undefined) throw new Error('Usage: bun tools/jev-abstention-report.ts <private-decision.json>')
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
  console.log(JSON.stringify(reportJevAbstention(raw)))
}

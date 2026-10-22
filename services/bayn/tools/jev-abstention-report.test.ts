import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { decideJevEntry } from '../src/jev/decision'
import { nativeJevDecisionEvidence } from '../src/jev/native.test-support'
import { jevObservationForSnapshot } from '../src/jev/native.test-support'
import { cryptoMarketFixture } from '../src/testing/crypto-market-fixture'
import { reportJevAbstention, summarizeJevChoiceMass } from './jev-abstention-report'

const documentFor = (action = 'wait') => {
  const evidence = nativeJevDecisionEvidence(undefined, action)
  return {
    mode: 'PAPER',
    bindings: { cycleId: evidence.observation.cycleId },
    strategyDecision: Result.getOrThrow(decideJevEntry(evidence)),
  }
}

test('sealed wait diagnostics preserve decisions and distinguish protocol from input versions', () => {
  const document = documentFor()
  const original = JSON.stringify(document)
  const report = reportJevAbstention(document)
  expect(report).toMatchObject({
    diagnosticOnly: true,
    schemaVersion: 'bayn.jev-abstention-report.v2',
    protocol: 'bayn.jev.protocol.v17',
    inputDefinition: 'bayn.jev-trading-signal-state.v16',
    selectedSymbols: [],
    profitableEdgeProven: false,
  })
  const candidate = report.candidates.find((value) => value.symbol === 'AAPL')
  expect(candidate).toMatchObject({
    chosenAction: 'wait',
    chosenSetup: 'upward',
    setupProbabilities: { upward: 0.8 },
    planChoiceCondition: 'SUPPORTED_LONG_SETUP_ASSUMED',
    rejection: 'MODEL_WAIT',
    fundedPlanCount: 16,
    horizonMinutes: 15,
    choiceMass: { waitMass: 0.8 },
    coverage: { suppliedBarCount: 30 },
  })
  expect(JSON.stringify(document)).toBe(original)
  expect(reportJevAbstention(document)).toEqual(report)
})

test('reports accepted plans without altering selection and rejects tampered decisions or source requests', () => {
  const document = documentFor('enter')
  expect(reportJevAbstention(document).selectedSymbols).toEqual(document.strategyDecision.selectedSymbols)
  expect(() => reportJevAbstention({ ...document, bindings: { cycleId: 'f'.repeat(64) } })).toThrow()
  expect(() =>
    reportJevAbstention({ ...document, strategyDecision: { ...document.strategyDecision, selectedSymbols: [] } }),
  ).toThrow()
  const altered = JSON.parse(JSON.stringify(document))
  altered.strategyDecision.evidence.batchPlan.candidates[0].request.request.state.task.horizonMinutes = 60
  expect(() => reportJevAbstention(altered)).toThrow()
})

test('fragmented categorical plan mass is not a profit probability or permission to override argmax', () => {
  const probabilities = {
    wait: 0.3,
    avoid: 0.1,
    ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`plan_${i}`, 0.6 / 16])),
  }
  const summary = summarizeJevChoiceMass(probabilities)
  expect(summary.interpretation).toBe('CATEGORICAL_CHOICE_MASS_NOT_PROFIT_PROBABILITY')
  expect(summary.aggregatePlanMass).toBeCloseTo(0.6)
  expect(summary.maximumPlanMass).toBe(0.0375)
  expect(Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0]).toBe('wait')
  expect(summarizeJevChoiceMass({ wait: 0.7, avoid: 0.3 })).toMatchObject({
    aggregatePlanMass: 0,
    maximumPlanMass: null,
  })

  expect(
    summarizeJevChoiceMass(Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`plan_${i}`, 0.063])))
      .aggregatePlanMass,
  ).toBeCloseTo(1.008)
})

test('crypto economics and coverage are measured from sealed source rather than choice mass', () => {
  const { snapshot } = cryptoMarketFixture('SOL/USD')
  const observation = Result.getOrThrow(jevObservationForSnapshot(snapshot))
  const evidence = nativeJevDecisionEvidence({ observation, protocol: observation.payload.protocol }, 'wait')
  const strategyDecision = Result.getOrThrow(decideJevEntry(evidence))
  const report = reportJevAbstention({
    mode: 'PAPER',
    bindings: { cycleId: observation.payload.cycleId },
    strategyDecision,
  })
  const candidate = report.candidates.find((value) => value.symbol === 'SOL/USD')
  if (candidate === undefined || candidate.plans === undefined || candidate.coverage === undefined)
    throw new Error('Expected requested SOL candidate')
  expect(candidate.fees).toEqual({ estimatedFeeBpsPerSide: 25, estimatedRoundTripFeesBps: 50 })
  expect(candidate.entryEconomics?.requiredBidRiseBps).toBeGreaterThan(80)
  expect(candidate.netRewardRisk).toEqual({
    minimum: Math.min(...candidate.plans.map((plan) => plan.netRewardRisk)),
    maximum: Math.max(...candidate.plans.map((plan) => plan.netRewardRisk)),
  })
  for (const plan of candidate.plans) {
    expect(plan.netRewardRisk).toBeCloseTo(plan.estimatedProfitUsd / plan.estimatedLossUsd)
    expect(plan.targetRiseFromBidBps).toBeGreaterThan(candidate.entryEconomics?.requiredBidRiseBps ?? Infinity)
  }
  const bars = snapshot.bars.filter((bar) => bar.symbol === 'SOL/USD')
  expect(candidate.coverage.suppliedBarCount).toBe(bars.length)
  expect(candidate.coverage.zeroVolumeBarCount).toBe(bars.filter((bar) => bar.volume === 0).length)
  expect(candidate.coverage.unknownTradeCountBarCount).toBe(bars.filter((bar) => bar.tradeCount === null).length)
})

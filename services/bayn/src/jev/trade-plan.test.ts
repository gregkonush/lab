import { expect, test } from 'bun:test'
import { Result, Schema } from 'effect'

import { canonicalHashV1Result } from '../hash'
import { JevCandidatePlanStatus } from './batch'
import { decodeJevProtocol, defaultJevProtocolDocument } from './protocol'
import { decideJevEntry, JevEntryTargetSchema } from './decision'
import { nativeJevFixture, nativeJevDecisionEvidence } from './native.test-support'
import { makeJevTradingSignalRequest } from './trading-signals'
import { selectedJevTradePlan } from './trade-plan-choices'
import { nativeJevInference } from './native.test-support'

const fixture = nativeJevFixture()

test('negative own and relative returns reach Jev without a momentum gate', () => {
  const falling = nativeJevFixture(undefined, undefined, undefined, undefined, undefined, { AAPL: -0.02, AMZN: -0.03 })
  const evidence = nativeJevDecisionEvidence(falling)
  expect(Result.getOrThrow(decideJevEntry(evidence)).selectedSymbols).toEqual(['AAPL'])
  for (const candidate of evidence.batchPlan.candidates) expect(candidate.status).toBe(JevCandidatePlanStatus.Requested)
  const request = evidence.batchPlan.candidates.find((candidate) => candidate.symbol === 'AAPL')
  if (request?.status !== JevCandidatePlanStatus.Requested) throw new Error('Expected Jev request')
  expect(JSON.stringify(request.request.request.state)).toContain('lookbackReturnBps')
  expect(request.request.request.questions['action']?.type).toBe('choice')
})

test('the selected model stop and profit prices reproduce the sealed entry', () => {
  const evidence = nativeJevDecisionEvidence(fixture)
  const target = Result.getOrThrow(decideJevEntry(evidence))
  expect(target.selectedSymbols).toEqual(['AAPL'])
  const plan = target.exitPolicy.plans['AAPL']
  const requested = evidence.batchPlan.candidates.find((candidate) => candidate.symbol === 'AAPL')
  if (plan === undefined || requested?.status !== JevCandidatePlanStatus.Requested)
    throw new Error('Expected model plan')
  const action = requested.request.request.questions['action']
  expect(action?.type).toBe('choice')
  expect(plan.levels.rule).toBe('model-selected-complete-plan')
  if (action?.type !== 'choice') throw new Error('Expected complete-plan question')
  const proposed = action.criteria['plan_0']
  expect(proposed).toHaveProperty('plan', plan)
  expect(Schema.is(JevEntryTargetSchema)(target)).toBe(true)
  const forged = structuredClone(target)
  const forgedPlan = forged.exitPolicy.plans['AAPL']
  if (forgedPlan === undefined) throw new Error('Expected plan')
  expect(
    Schema.is(JevEntryTargetSchema)({
      ...forged,
      exitPolicy: {
        ...forged.exitPolicy,
        plans: { AAPL: { ...forgedPlan, levels: { ...forgedPlan.levels, stopPriceMicros: '1000000' } } },
      },
    }),
  ).toBe(false)
})

test('abstention and an unknown complete plan cannot authorize entry', () => {
  const prepared = Result.getOrThrow(makeJevTradingSignalRequest(fixture.observation.payload, 'AAPL'))
  const at = fixture.snapshot.manifest.observedAt
  for (const choice of ['wait', 'avoid']) {
    const inference = nativeJevInference(prepared.request, at, choice)
    expect(Result.getOrThrow(selectedJevTradePlan(prepared.request, inference.response))).toBeNull()
    expect(Result.getOrThrow(decideJevEntry(nativeJevDecisionEvidence(fixture, choice))).selectedSymbols).toEqual([])
  }
  const inference = nativeJevInference(prepared.request, at)
  const action = inference.response.answers['action']
  if (action?.type !== 'choice') throw new Error('Expected plan choice')
  expect(
    Result.isFailure(
      selectedJevTradePlan(prepared.request, {
        ...inference.response,
        answers: { action: { ...action, choice: 'plan_unknown' } },
      }),
    ),
  ).toBe(true)
  expect(
    Result.isFailure(
      selectedJevTradePlan(prepared.request, {
        ...inference.response,
        answers: {},
      }),
    ),
  ).toBe(true)
})

test('the retired geometric protocol and exit caps are rejected rather than used as defaults', () => {
  expect(
    Result.isFailure(decodeJevProtocol({ ...defaultJevProtocolDocument, schemaVersion: 'bayn.jev.protocol.v14' })),
  ).toBe(true)
  expect(Result.isFailure(decodeJevProtocol({ ...defaultJevProtocolDocument, maximumCapitalRiskBps: 10 }))).toBe(true)
  expect(Result.isFailure(decodeJevProtocol({ ...defaultJevProtocolDocument, maximumStopBps: 500 }))).toBe(true)
  expect(Result.getOrThrow(canonicalHashV1Result(defaultJevProtocolDocument))).not.toBe(
    '7cf76109bc5301a4eabef41f4cf37ea531b3bb87c6b5246d74970262398936de',
  )
})

test('model prices and funded size are not replaced by the retired distance or capital-risk caps', () => {
  const target = Result.getOrThrow(decideJevEntry(nativeJevDecisionEvidence(fixture)))
  const plan = target.exitPolicy.plans['AAPL']
  if (plan === undefined) throw new Error('Expected the chosen protected entry')
  const entry = BigInt(plan.levels.maximumEntryPriceMicros)
  expect((entry - BigInt(plan.levels.stopPriceMicros)) * 10_000n).toBeGreaterThan(entry * 500n)
  const estimatedLoss = BigInt(plan.acquisitionCostMicros) - BigInt(plan.estimatedStopNetMicros)
  expect(estimatedLoss).toBeGreaterThan(BigInt(fixture.portfolio.brokerState.account.equityMicros) / 1000n)
  expect(target.targetWeights['AAPL']).toBe(0.2)
})

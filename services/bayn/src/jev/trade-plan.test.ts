import { expect, test } from 'bun:test'
import { Result, Schema } from 'effect'

import { canonicalHashV1 } from '../hash'
import { JevCandidatePlanStatus } from './batch'
import { decodeJevProtocol, defaultJevProtocolDocument } from './protocol'
import { decideJevEntry, JevEntryTargetSchema } from './decision'
import { nativeJevFixture, nativeJevDecisionEvidence } from './native.test-support'
import { makeJevTradingSignalRequest } from './trading-signals'
import { selectedJevTradeLevels } from './trade-price-choices'
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
  expect(request.request.request.questions['stop_loss']?.type).toBe('choice')
})

test('the selected model stop and profit prices reproduce the sealed entry', () => {
  const evidence = nativeJevDecisionEvidence(fixture)
  const target = Result.getOrThrow(decideJevEntry(evidence))
  expect(target.selectedSymbols).toEqual(['AAPL'])
  const plan = target.exitPolicy.plans['AAPL']
  const requested = evidence.batchPlan.candidates.find((candidate) => candidate.symbol === 'AAPL')
  if (plan === undefined || requested?.status !== JevCandidatePlanStatus.Requested)
    throw new Error('Expected model plan')
  const stop = requested.request.request.questions['stop_loss']
  const profit = requested.request.request.questions['take_profit']
  expect(stop?.type).toBe('choice')
  expect(profit?.type).toBe('choice')
  expect(plan.levels.rule).toBe('model-selected-observed-prices')
  expect(plan.levels.stopPriceMicros).toBe(
    Object.keys(stop?.type === 'choice' ? stop.criteria : {})
      .find((key) => key.startsWith('price_'))
      ?.slice(6) ?? '',
  )
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

test('missing or declined model protection cannot authorize an entry', () => {
  const prepared = Result.getOrThrow(makeJevTradingSignalRequest(fixture.observation.payload, 'AAPL'))
  const inference = nativeJevInference(prepared.request, fixture.snapshot.manifest.observedAt)
  const base = {
    request: prepared.request,
    response: inference.response,
    symbol: 'AAPL',
    bidMicros: 102_000_000n,
    maximumEntryPriceMicros: 103_000_000n,
    sourceStartAt: fixture.snapshot.manifest.rangeStartAt,
    sourceEndAt: fixture.snapshot.manifest.rangeEndAt,
    protocol: fixture.protocol,
  }
  expect(
    Result.getOrThrow(
      selectedJevTradeLevels({
        ...base,
        response: { ...inference.response, answers: { action: inference.response.answers['action']! } },
      }),
    ),
  ).toBeNull()
  const stop = inference.response.answers['stop_loss']
  if (stop?.type !== 'choice') throw new Error('Expected typed stop')
  expect(
    Result.getOrThrow(
      selectedJevTradeLevels({
        ...base,
        response: {
          ...inference.response,
          answers: { ...inference.response.answers, stop_loss: { ...stop, choice: 'none' } },
        },
      }),
    ),
  ).toBeNull()
  expect(
    Result.isFailure(
      selectedJevTradeLevels({
        ...base,
        response: {
          ...inference.response,
          answers: { ...inference.response.answers, stop_loss: { ...stop, choice: 'price_1' } },
        },
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
  expect(canonicalHashV1(defaultJevProtocolDocument)).not.toBe(
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

import { describe, expect, setDefaultTimeout, test } from 'bun:test'
import { Result } from 'effect'

import { canonicalHashV1Result } from '../hash'
import { IntradayCandidateEvidencePolicy } from '../market-data/intraday/model'
import { constructStreamingSnapshot } from '../market-data/streaming/snapshot'
import { streamingFixture } from '../testing/streaming-market-fixture'
import { JevBatchPlanVersion, JevCandidatePlanStatus } from './batch'
import { decideJevEntry } from './decision'
import { JevPurpose } from './portfolio'
import { jevInstructions } from './instructions'
import { jevHarnessDecision, prepareJevHarnessProbe, verifyJevHarnessReceipt } from './harness2'
import {
  jevObservationForSnapshot,
  nativeJevDecisionEvidence,
  nativeJevFixture,
  nativeJevInference,
} from './native.test-support'
import { makeJevTradingSignalBatch, makeJevTradingSignalRequest } from './trading-signals'

setDefaultTimeout(30_000)

const fixture = nativeJevFixture()
const run = () => ({
  schemaVersion: 'bayn.jev-harness2-probe.v1',
  sourceRevision: 'a'.repeat(40),
  studyId: 'b'.repeat(64),
  registeredAt: fixture.observation.payload.observedAt,
  deadlineAt: new Date(Date.parse(fixture.observation.payload.observedAt) + 179_000).toISOString(),
  observation: fixture.observation.payload,
  instructions: jevInstructions,
})
const at = new Date(Date.parse(fixture.observation.payload.observedAt) + 100).toISOString()
const receiptMaterial = (prepared: Result.Result.Success<ReturnType<typeof prepareJevHarnessProbe>>) => {
  const completedAt = new Date(Date.parse(prepared.run.registeredAt) + 100).toISOString()
  const inferences = prepared.requests.map(({ symbol, request }) => ({
    symbol,
    inference: nativeJevInference(request, completedAt),
  }))
  return {
    schemaVersion: 'bayn.jev-harness2-receipt.v2',
    runId: prepared.runId,
    sourceRevision: prepared.run.sourceRevision,
    observationHash: prepared.observation.contentHash,
    instructionsHash: Result.getOrThrow(canonicalHashV1Result(prepared.run.instructions)),
    startedAtMs: Date.parse(prepared.run.registeredAt),
    completedAtMs: Date.parse(completedAt),
    outcome: 'COMPLETE',
    excludedCandidates: prepared.excludedCandidates,
    requests: prepared.requests.map(({ symbol, originalRequestHash, request, requestHash }, index) => ({
      symbol,
      originalRequestHash,
      request,
      requestHash,
      inference: inferences[index]?.inference,
      failure: null,
    })),
    decision: Result.getOrThrow(jevHarnessDecision(prepared, inferences)),
    costPicoUsd: null,
    qualification: 'UNQUALIFIED',
    timingQualification: 'OFFLINE_REEVALUATION',
  }
}

describe('Harness2 uses native Jev requests and decision policy', () => {
  test('reproduces native exclusions when a candidate lacks window trades', () => {
    const { cut, query } = streamingFixture()
    const tradeHistory = new Map(cut.projection.tradeHistory)
    tradeHistory.delete('AAPL')
    const snapshot = Result.getOrThrow(
      constructStreamingSnapshot(
        { ...cut, projection: { ...cut.projection, tradeHistory } },
        { ...query, candidateEvidencePolicy: IntradayCandidateEvidencePolicy.QuoteWithWindowTrade },
      ),
    )
    const observation = Result.getOrThrow(jevObservationForSnapshot(snapshot))
    const native = Result.getOrThrow(
      makeJevTradingSignalBatch({
        observation: observation.payload,
        expiresAt: new Date(
          Date.parse(observation.payload.observedAt) + observation.payload.protocol.inferenceValidityMs,
        ).toISOString(),
        planVersion: JevBatchPlanVersion.V6,
      }),
    )
    expect(native.candidates.some((entry) => entry.status === JevCandidatePlanStatus.Excluded)).toBe(true)
    const prepared = Result.getOrThrow(prepareJevHarnessProbe({ ...run(), observation: observation.payload }))
    expect(prepared.requests.map(({ symbol, requestHash }) => ({ symbol, requestHash }))).toEqual(
      native.candidates.flatMap((entry) =>
        entry.status === JevCandidatePlanStatus.Requested
          ? [{ symbol: entry.symbol, requestHash: entry.request.requestHash }]
          : [],
      ),
    )
    expect(prepared).toHaveProperty(
      'excludedCandidates',
      native.candidates.filter((entry) => entry.status === JevCandidatePlanStatus.Excluded),
    )
    const input = { ...run(), observation: observation.payload }
    const material = receiptMaterial(prepared)
    const seal = (value: typeof material) => ({
      ...value,
      receiptHash: Result.getOrThrow(canonicalHashV1Result(value)),
    })
    expect(Result.isSuccess(verifyJevHarnessReceipt(input, seal(material)))).toBe(true)
    for (const excludedCandidates of [
      [],
      material.excludedCandidates.map((row) => ({ ...row, message: 'Invented source failure' })),
    ])
      expect(Result.isFailure(verifyJevHarnessReceipt(input, seal({ ...material, excludedCandidates })))).toBe(true)
  })
  test('baseline reproduces live request bytes and funded entry selections', () => {
    const prepared = Result.getOrThrow(prepareJevHarnessProbe(run()))
    for (const request of prepared.requests)
      expect(request.requestHash).toBe(
        Result.getOrThrow(makeJevTradingSignalRequest(run().observation, request.symbol)).requestHash,
      )
    const inferences = prepared.requests.map(({ symbol, request }) => ({
      symbol,
      inference: nativeJevInference(request, at),
    }))
    const decision = Result.getOrThrow(jevHarnessDecision(prepared, inferences))
    const native = Result.getOrThrow(decideJevEntry(nativeJevDecisionEvidence(fixture)))
    expect(decision.purpose).toBe(JevPurpose.Entry)
    if ('selected' in decision) {
      expect(decision.selected.map(({ symbol }) => symbol)).toEqual(native.selectedSymbols)
      expect(decision.entryPlanRejections).toEqual(native.entryPlanRejections)
      for (const selected of decision.selected) {
        expect(selected.weight).toBe(native.targetWeights[selected.symbol])
        expect(selected.exitPlan).toEqual(native.exitPolicy.plans[selected.symbol])
      }
    }
  }, 15_000)
  test('edits affect only instruction text while preserving state and supplied choices', () => {
    const baseline = Result.getOrThrow(prepareJevHarnessProbe(run()))
    const candidate = Result.getOrThrow(
      prepareJevHarnessProbe({
        ...run(),
        instructions: {
          ...jevInstructions,
          entry: 'Assess the supplied entry evidence and select the applicable action.',
        },
      }),
    )
    for (const [index, request] of candidate.requests.entries()) {
      const original = baseline.requests[index]
      expect(request.request.state).toEqual(original?.request.state)
      expect(request.request.questions['action']).toEqual({
        ...original?.request.questions['action'],
        instructions: 'Assess the supplied entry evidence and select the applicable action.',
      })
      expect(request.request.questions['setup']).toEqual(original?.request.questions['setup'])
      expect(Object.keys(request.request.questions)).toEqual(['action', 'setup'])
      expect(request.requestHash).not.toBe(original?.requestHash)
    }
    expect(
      Result.isFailure(
        prepareJevHarnessProbe({ ...run(), instructions: { ...jevInstructions, tools: 'Place an order' } }),
      ),
    ).toBe(true)
  }, 15_000)
  test('retired separate protection instructions cannot enter the complete-plan harness', () => {
    expect(
      Result.isFailure(
        prepareJevHarnessProbe({
          ...run(),
          instructions: { ...jevInstructions, stopLoss: 'Choose stop', takeProfit: 'Choose target' },
        }),
      ),
    ).toBe(true)
  })
  test('incomplete probes cannot become decisions and malformed native evidence fails', () => {
    const prepared = Result.getOrThrow(prepareJevHarnessProbe(run()))
    expect(Result.isFailure(jevHarnessDecision(prepared, []))).toBe(true)
    expect(
      Result.isFailure(
        prepareJevHarnessProbe({
          ...run(),
          observation: {
            ...run().observation,
            observedAt: '1970-01-01T00:00:00.000Z',
          },
        }),
      ),
    ).toBe(true)
  })
  test.each(['valid', 'missing-decision', 'wrong-run'] as const)(
    'retained receipts reproduce their requests, inference evidence and native decision: %s',
    (scenario) => {
      const prepared = Result.getOrThrow(prepareJevHarnessProbe(run()))
      const material = receiptMaterial(prepared)
      const seal = (value: Omit<typeof material, 'decision'> & { readonly decision: unknown }) => ({
        ...value,
        receiptHash: Result.getOrThrow(canonicalHashV1Result(value)),
      })
      if (scenario === 'valid') {
        expect(Result.isSuccess(verifyJevHarnessReceipt(run(), seal(material)))).toBe(true)
      } else if (scenario === 'missing-decision') {
        expect(Result.isFailure(verifyJevHarnessReceipt(run(), seal({ ...material, decision: null })))).toBe(true)
      } else {
        expect(Result.isFailure(verifyJevHarnessReceipt(run(), { ...seal(material), runId: 'c'.repeat(64) }))).toBe(
          true,
        )
      }
    },
    15_000,
  )
})

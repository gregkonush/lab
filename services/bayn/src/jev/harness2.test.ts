import { describe, expect, test } from 'bun:test'
import { Result } from 'effect'

import { canonicalHashV1Result } from '../hash'
import { decideJevEntry } from './decision'
import { JevPurpose } from './portfolio'
import { jevInstructions } from './instructions'
import { jevHarnessDecision, prepareJevHarnessProbe, verifyJevHarnessReceipt } from './harness2'
import { nativeJevDecisionEvidence, nativeJevFixture, nativeJevInference } from './native.test-support'
import { makeJevTradingSignalRequest } from './trading-signals'

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

describe('Harness2 uses native Jev requests and decision policy', () => {
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
  })
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
      expect(Object.keys(request.request.questions)).toEqual(['action'])
      expect(request.requestHash).not.toBe(original?.requestHash)
    }
    expect(
      Result.isFailure(
        prepareJevHarnessProbe({ ...run(), instructions: { ...jevInstructions, tools: 'Place an order' } }),
      ),
    ).toBe(true)
  })
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
  test('retained receipts reproduce their requests, inference evidence and native decision', () => {
    const prepared = Result.getOrThrow(prepareJevHarnessProbe(run()))
    const inferences = prepared.requests.map(({ symbol, request }) => ({
      symbol,
      inference: nativeJevInference(request, at),
    }))
    const material = {
      schemaVersion: 'bayn.jev-harness2-receipt.v1',
      runId: prepared.runId,
      sourceRevision: run().sourceRevision,
      observationHash: prepared.observation.contentHash,
      instructionsHash: Result.getOrThrow(canonicalHashV1Result(jevInstructions)),
      startedAtMs: Date.parse(run().registeredAt),
      completedAtMs: Date.parse(at),
      outcome: 'COMPLETE',
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
    const seal = (value: Omit<typeof material, 'decision'> & { readonly decision: unknown }) => ({
      ...value,
      receiptHash: Result.getOrThrow(canonicalHashV1Result(value)),
    })
    expect(Result.isSuccess(verifyJevHarnessReceipt(run(), seal(material)))).toBe(true)
    expect(Result.isFailure(verifyJevHarnessReceipt(run(), seal({ ...material, decision: null })))).toBe(true)
    expect(Result.isFailure(verifyJevHarnessReceipt(run(), { ...seal(material), runId: 'c'.repeat(64) }))).toBe(true)
  }, 30_000)
})

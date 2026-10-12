import { describe, expect, test } from 'bun:test'
import { Result } from 'effect'
import { sha256 } from '../hash'
import { decodeResearchRun, hashResearch, ResearchOutcome, researchRequest, sealResearchReceipt } from './contract'
import { researchExpensePlan, verifyResearchReceipt } from './store'
import { researchFixture, streamFixture } from './test-support'

const run = researchFixture()
const id = Result.getOrThrow(hashResearch(run))
const receipt = (outcome = ResearchOutcome.Complete) =>
  Result.getOrThrow(
    sealResearchReceipt(run, {
      runId: id,
      requestHash: Result.getOrThrow(hashResearch(researchRequest(run))),
      startedAtMs: 0,
      completedAtMs: 1001,
      firstTokenAtMs: 1,
      outcome,
      httpStatus: 200,
      serverRequestId: 'chatcmpl-synthetic',
      responseBase64: Buffer.from(streamFixture()).toString('base64'),
      responseHash: sha256(streamFixture()),
      responseText: '<alpha_list>alpha001</alpha_list>',
      factors: ['alpha001'],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }),
  )
describe('frozen research contract and existing expense ledger', () => {
  test('binds all generation overrides, semantic bytes, arm and attempt identities', () => {
    for (const policy of [
      { ...run.policy, seed: 2 },
      { ...run.policy, max_tokens: 3000 },
      { ...run.policy, enable_thinking: false },
      { ...run.policy, stop: ['x'] },
    ])
      expect(Result.getOrThrow(hashResearch({ ...run, policy }))).not.toBe(id)
    for (const changed of [
      { ...run, attempt: 1 },
      { ...run, armManifestHashes: ['5'.repeat(64)] },
      { ...run, context: { ...run.context, producerManifestHash: '6'.repeat(64) } },
    ])
      expect(Result.getOrThrow(hashResearch(changed))).not.toBe(id)
    expect(researchRequest(run).stream_options.include_usage).toBe(true)
    expect(researchRequest(run).messages[0]?.content).toContain(run.context.factors[0]?.description ?? '')
  })
  test('rejects unfrozen overrides, future labels, mismatched descriptions and unsupported free rates', () => {
    const factor = run.context.factors[0]
    expect(factor).toBeDefined()
    for (const changed of [
      { ...run, policy: { ...run.policy, best_of: 3 } },
      {
        ...run,
        context: {
          ...run.context,
          factors: [
            { ...factor, performance: { ...factor?.performance, labelsMaturedAt: '1970-01-01T00:00:00.001Z' } },
          ],
        },
      },
      { ...run, context: { ...run.context, factors: [{ ...factor, description: 'changed' }] } },
      { ...run, costBasis: { ...run.costBasis, picoUsdPerSecond: '0' } },
      { ...run, costBasis: { ...run.costBasis, picoUsdPerSecond: (2n ** 128n / 180n + 1n).toString() } },
    ])
      expect(Result.isFailure(decodeResearchRun(changed))).toBe(true)
    expect(
      Result.isSuccess(
        decodeResearchRun({
          ...run,
          costBasis: { ...run.costBasis, picoUsdPerSecond: ((2n ** 128n - 1n) / 180n).toString() },
        }),
      ),
    ).toBe(true)
  })
  test('allocates integer USD_PICO without floating point or changing posted identities', () => {
    const value = receipt()
    expect(value.costPicoUsd).toBe('1001000002')
    const plan = Result.getOrThrow(researchExpensePlan(run, value))
    expect(plan.accounts).toHaveLength(2)
    expect(plan.transfers[0]?.amount).toBe(1001000002n)
    expect(plan.transfers[0]?.ledger).toBe(7002)
    expect(Result.getOrThrow(researchExpensePlan(run, value))).toEqual(plan)
    expect(Result.isFailure(verifyResearchReceipt(run, { ...value, costPicoUsd: '1' }))).toBe(true)
    expect(Result.isFailure(verifyResearchReceipt({ ...run, attempt: 1 }, value))).toBe(true)
  })
  test.each([ResearchOutcome.Expired, ResearchOutcome.Ambiguous, ResearchOutcome.Rejected])(
    'keeps %s operating costs unknown',
    (outcome) => {
      expect(receipt(outcome).costPicoUsd).toBeNull()
      expect(Result.getOrThrow(researchExpensePlan(run, receipt(outcome))).transfers).toEqual([])
    },
  )
  test('rejects resealed success receipts with inconsistent HTTP or token timing', () => {
    const {
      schemaVersion: _version,
      qualification: _qualification,
      receiptHash: _hash,
      costPicoUsd: _cost,
      ...material
    } = receipt()
    for (const changed of [
      { ...material, httpStatus: 503 },
      { ...material, firstTokenAtMs: null },
      { ...material, firstTokenAtMs: material.completedAtMs + 1 },
    ]) {
      const resealed = Result.getOrThrow(sealResearchReceipt(run, changed))
      expect(Result.isFailure(verifyResearchReceipt(run, resealed))).toBe(true)
    }
  })
})

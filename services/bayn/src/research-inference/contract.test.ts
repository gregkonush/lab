import { describe, expect, test } from 'bun:test'
import { Result } from 'effect'
import { sha256 } from '../hash'
import {
  decodeResearchRun,
  hashResearch,
  HarnessPurpose,
  maximumResearchStreamBytes,
  parseResearchOutput,
  ResearchOutcome,
  researchRequest,
  researchServingIdentity,
  sealResearchReceipt,
} from './contract'
import { researchExpensePlan, verifyResearchReceipt } from './store'
import { fullTokenBudgetStreamFixture, harnessEditorFixture, researchFixture, streamFixture } from './test-support'

const run = researchFixture()
const id = Result.getOrThrow(hashResearch(run))
const receipt = (outcome = ResearchOutcome.Complete, stream = streamFixture(), completionTokens = 20) =>
  Result.getOrThrow(
    sealResearchReceipt(run, {
      runId: id,
      requestHash: Result.getOrThrow(hashResearch(researchRequest(run))),
      startedAtMs: 0,
      completedAtMs: 1001,
      firstTokenAtMs: 1,
      outcome,
      httpStatus: 200,
      servingIdentity: researchServingIdentity(run.policy),
      serverRequestId: 'chatcmpl-synthetic',
      responseBase64: Buffer.from(stream).toString('base64'),
      responseHash: sha256(stream),
      responseText: '<alpha_list>alpha001</alpha_list>',
      factors: ['alpha001'],
      usage: { prompt_tokens: 10, completion_tokens: completionTokens, total_tokens: 10 + completionTokens },
    }),
  )
describe('frozen research contract and existing expense ledger', () => {
  test('constrains prompt edits to the native instruction JSON schema', () => {
    const current = harnessEditorFixture()
    expect(researchRequest(current)).toMatchObject({
      response_format: {
        type: 'json_schema',
        json_schema: {
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['entry'],
            properties: { entry: { type: 'string', maxLength: 2000 } },
          },
        },
      },
    })
    expect(
      Result.isFailure(parseResearchOutput(current, '<harness>{"currentInstructions":{"entry":"Assess"}}</harness>')),
    ).toBe(true)
    expect(Result.isFailure(parseResearchOutput(current, '{"currentInstructions":{"entry":"Assess"}}'))).toBe(true)
    expect(Result.isSuccess(parseResearchOutput(current, '{"entry":"Assess"}'))).toBe(true)
  })
  test.each([
    '{"entry":""}',
    '{"entry":"   "}',
    JSON.stringify({ entry: 'a'.repeat(2001) }),
    '{"entry":"Assess","notes":"extra output"}',
    '<harness>{"entry":"Assess"}</harness>',
    '{"entry":"Assess"} trailing text',
  ])('rejects non-native structured editor documents %#', (output) => {
    expect(Result.isFailure(parseResearchOutput(harnessEditorFixture(), output))).toBe(true)
  })
  test('keeps reflection outside the instruction JSON format', () => {
    const reflection = { ...harnessEditorFixture(), purpose: HarnessPurpose.Reflection }
    expect(researchRequest(reflection)).not.toHaveProperty('response_format')
    expect(Result.getOrThrow(parseResearchOutput(reflection, 'NO_ENTRY'))).toEqual([])
  })
  test('preserves the original unconstrained v2 provider request identity for retained receipts', () => {
    const historical = Result.getOrThrow(
      decodeResearchRun({
        ...harnessEditorFixture(),
        schemaVersion: 'bayn.jev-harness2-editor.v2',
        promptTemplate: 'Revise only the three Jev instructions using the supplied development evidence.',
      }),
    )
    expect(Result.getOrThrow(hashResearch(researchRequest(historical)))).toBe(
      'abc0a20675fde2fb65bf6b88218a31c1bb54a03a19f94250129658bc241a65ae',
    )
    expect(researchRequest(historical)).not.toHaveProperty('response_format')
    expect(
      Result.isSuccess(
        parseResearchOutput(historical, '<harness>{"currentInstructions":{"entry":"Assess"}}</harness>'),
      ),
    ).toBe(true)
  })
  test('current Jev editor is bound to the general instruction checkpoint and rejects Alpha-R1 substitution', () => {
    const current = harnessEditorFixture()
    expect(researchRequest(current).model).toBe('qwen3-jev-editor-b968826d9c46')
    expect(researchRequest(current).chat_template_kwargs.enable_thinking).toBe(false)
    const { maximumFactors: _historicalLimit, ...retired } = run.policy
    expect(Result.isFailure(decodeResearchRun({ ...current, policy: retired }))).toBe(true)
    expect(researchRequest(current).messages[0]?.content).not.toContain('<alpha_list>')
  })
  test('Jev editors use native instruction text without factor-selection context', () => {
    const { maximumFactors: _retired, ...policy } = run.policy
    const editor = Result.getOrThrow(
      decodeResearchRun({
        ...run,
        schemaVersion: 'bayn.jev-harness2-editor.v1',
        purpose: HarnessPurpose.PromptEdit,
        context: { memory: run.context.memory },
        policy,
      }),
    )
    const content = researchRequest(editor).messages[0]?.content
    expect(content).toContain('<harness>')
    expect(content).not.toContain('<alpha_list>')
    expect(content).not.toContain('alpha001')
    expect(Result.isFailure(decodeResearchRun({ ...editor, context: run.context }))).toBe(true)
  })
  test('binds the harness role and verifies its original bytes through the same receipt and expense path', () => {
    const edit = Result.getOrThrow(
      decodeResearchRun({ ...run, schemaVersion: 'bayn.harness2-inference.v1', purpose: HarnessPurpose.PromptEdit }),
    )
    const text = '<harness>Return IDs in <alpha_list> tags.</harness>'
    const stream = streamFixture(text)
    const {
      receiptHash: _hash,
      costPicoUsd: _cost,
      schemaVersion: _version,
      qualification: _qualification,
      ...material
    } = receipt()
    const value = Result.getOrThrow(
      sealResearchReceipt(edit, {
        ...material,
        runId: Result.getOrThrow(hashResearch(edit)),
        requestHash: Result.getOrThrow(hashResearch(researchRequest(edit))),
        responseText: text,
        responseBase64: Buffer.from(stream).toString('base64'),
        responseHash: sha256(stream),
        factors: [],
      }),
    )
    expect(Result.getOrThrow(verifyResearchReceipt(edit, value))).toEqual(value)
    expect(Result.getOrThrow(researchExpensePlan(edit, value)).transfers[0]?.amount).toBe(1001000002n)
    expect(Result.isFailure(verifyResearchReceipt(run, value))).toBe(true)
    expect(Result.getOrThrow(hashResearch(edit))).not.toBe(id)
    expect(researchRequest(edit).messages[0]?.content).not.toContain('Select at most')
    expect(Result.isFailure(decodeResearchRun({ ...edit, purpose: 'trade' }))).toBe(true)
    expect(Result.isFailure(decodeResearchRun({ ...run, purpose: HarnessPurpose.PromptEdit }))).toBe(true)
  })
  test('verifies and prices an immutable receipt containing the full approved stream', () => {
    const value = receipt(ResearchOutcome.Complete, fullTokenBudgetStreamFixture(), 4096)
    expect(Result.getOrThrow(verifyResearchReceipt(run, value))).toEqual(value)
    expect(Result.getOrThrow(researchExpensePlan(run, value)).transfers[0]?.amount).toBe(1001000002n)
  })
  test('rejects decoded response bytes above the bound even when base64 padding has spare capacity', () => {
    const bytes = Buffer.alloc(maximumResearchStreamBytes + 1)
    const value = {
      ...receipt(ResearchOutcome.Expired),
      responseBase64: bytes.toString('base64'),
      responseHash: sha256(bytes),
    }
    const {
      schemaVersion: _version,
      qualification: _qualification,
      receiptHash: _hash,
      costPicoUsd: _cost,
      ...material
    } = value
    expect(Result.isFailure(verifyResearchReceipt(run, Result.getOrThrow(sealResearchReceipt(run, material))))).toBe(
      true,
    )
  })
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
      { ...material, servingIdentity: null },
      { ...material, servingIdentity: { ...researchServingIdentity(run.policy), checkpoint: '0'.repeat(40) } },
      { ...material, firstTokenAtMs: null },
      { ...material, firstTokenAtMs: material.completedAtMs + 1 },
    ]) {
      const resealed = Result.getOrThrow(sealResearchReceipt(run, changed))
      expect(Result.isFailure(verifyResearchReceipt(run, resealed))).toBe(true)
    }
  })
})

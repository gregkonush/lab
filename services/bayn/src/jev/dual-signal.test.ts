import { describe, expect, test } from 'bun:test'
import { Effect, Layer, Result } from 'effect'

import { JevClient, JevError } from './client'
import { JevFailure, jevModel, prepareJevRequest } from './contract'
import {
  decodeVisualDecision,
  evaluateDualSignalResearch,
  VisualDecisionClient,
  visualDecisionRequest,
} from './dual-signal'
import { JevEntrySetup } from './trade-plan-choices'
import { nativeCandlestickEvidence, verifiedVisualBars } from './visual-evidence'

const bars = Array.from({ length: 30 }, (_, index) => {
  const price = 100 + index * 0.13
  return {
    minuteBeforeWindowEnd: 30 - index,
    open: price,
    high: price + 0.35,
    low: price - 0.2,
    close: price + 0.18,
    volume: 1000 + index * 10,
  }
})
const request = Result.getOrThrow(
  prepareJevRequest({
    model: jevModel,
    state: { candidate: { symbol: 'AAPL', bars1m: bars }, session: { observedAt: '2026-10-22T20:00:00.000Z' } },
    questions: {
      setup: {
        type: 'choice',
        instructions: 'Classify observed setup',
        criteria: {
          [JevEntrySetup.Upward]: 'Current upward continuation',
          [JevEntrySetup.Unclear]: 'Mixed evidence',
          [JevEntrySetup.Adverse]: 'Adverse deterioration',
        },
      },
    },
  }),
).request

const visualResponse = {
  model: 'gpt-6-luna',
  answers: [
    {
      type: 'choice',
      name: 'chart_setup',
      choice: JevEntrySetup.Upward,
      confidence: 0.8,
      probabilities: [
        { value: JevEntrySetup.Upward, probability: 0.8 },
        { value: JevEntrySetup.Unclear, probability: 0.15 },
        { value: JevEntrySetup.Adverse, probability: 0.05 },
      ],
    },
  ],
  usage: {
    input_tokens: 1000,
    input_tokens_details: { cached_tokens: 100, cache_write_tokens: 200 },
    output_tokens: 0,
    total_tokens: 1000,
  },
} as const

const numerical = {
  requestHash: Result.getOrThrow(prepareJevRequest(request)).requestHash,
  responseHash: 'b'.repeat(64),
  startedAt: '2026-10-22T20:00:00.000Z',
  completedAt: '2026-10-22T20:00:00.400Z',
  response: {
    model: jevModel,
    answers: {
      setup: {
        type: 'choice',
        choice: JevEntrySetup.Upward,
        confidence: 0.8,
        probabilities: { upward: 0.8, unclear: 0.15, adverse: 0.05 },
      },
    },
    usage: { input_tokens: 2000, output_tokens: 200 },
  },
} as const

const visual = {
  startedAt: '2026-10-22T20:00:00.000Z',
  completedAt: '2026-10-22T20:00:00.850Z',
  responseHash: 'c'.repeat(64),
  response: Result.getOrThrow(decodeVisualDecision(visualResponse)),
}

const providers = () =>
  Layer.merge(
    Layer.succeed(JevClient, { evaluate: () => Effect.succeed(numerical) }),
    Layer.succeed(VisualDecisionClient, { evaluate: () => Effect.succeed(visual) }),
  )

describe('OHLCV + Decisions image shadow research', () => {
  test('renders deterministic native candlesticks and a real PNG header', () => {
    const first = Result.getOrThrow(nativeCandlestickEvidence(request))
    expect(first).toEqual(Result.getOrThrow(nativeCandlestickEvidence(request)))
    const image = Buffer.from(first.image.split(',')[1] ?? '', 'base64')
    expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(image.readUInt32BE(16)).toBe(640)
    expect(image.readUInt32BE(20)).toBe(360)
    expect(first.provenance).toBe('DERIVED_FROM_SAME_NATIVE_OHLCV')
    expect(visualDecisionRequest(first).input[0]?.content[1]?.type).toBe('input_image')
  })

  test('rejects impossible bars, missing bars and unordered evidence', () => {
    for (const changed of [
      bars.map((bar, i) => (i === 3 ? { ...bar, high: 0 } : bar)),
      bars.map((bar, i) => (i === 3 ? { ...bar, minuteBeforeWindowEnd: 60 } : bar)),
      bars.slice(0, 2),
    ]) {
      const updated = Result.getOrThrow(
        prepareJevRequest({ ...request, state: { candidate: { symbol: 'AAPL', bars1m: changed } } }),
      )
      expect(Result.isFailure(verifiedVisualBars(updated.request))).toBe(true)
    }
  })

  test('rejects refusals, invalid usage and duplicate model choices', () => {
    expect(
      Result.isFailure(
        decodeVisualDecision({ ...visualResponse, answers: [{ type: 'refusal', name: 'chart_setup' }] }),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        decodeVisualDecision({
          ...visualResponse,
          usage: { ...visualResponse.usage, input_tokens_details: { cached_tokens: 900, cache_write_tokens: 900 } },
        }),
      ),
    ).toBe(true)
    expect(
      Result.isFailure(
        decodeVisualDecision({ ...visualResponse, answers: [visualResponse.answers[0], visualResponse.answers[0]] }),
      ),
    ).toBe(true)
  })

  test('two provider calls produce sealed, metered, non-trading comparison', async () => {
    const report = await Effect.runPromise(
      evaluateDualSignalResearch(request, 'AAPL').pipe(Effect.provide(providers())),
    )
    expect(report.comparison).toMatchObject({ status: 'AGREEMENT', jevSetup: JevEntrySetup.Upward })
    expect(report.costs).toMatchObject({
      coverage: 'PROVIDER_METERED',
      jevEstimatedPicoUsd: '84000000',
      openAiEstimatedPicoUsd: '96000000',
    })
    expect(report.numerical).toMatchObject({ status: 'RECEIVED', setup: { choice: JevEntrySetup.Upward } })
    expect(report.visual).toMatchObject({ status: 'RECEIVED', setup: { choice: JevEntrySetup.Upward } })
    expect(report.reportHash).toMatch(/^[a-f0-9]{64}$/)
    expect(report.independentEvidence).toBe(false)
    expect(report.tradingAuthority).toBe('NONE')
  })

  test('provider errors are explicit and do not create a fused trade', async () => {
    const layers = Layer.merge(
      Layer.succeed(JevClient, {
        evaluate: () => Effect.fail(new JevError({ failure: JevFailure.Timeout, message: 'deadline' })),
      }),
      Layer.succeed(VisualDecisionClient, { evaluate: () => Effect.succeed(visual) }),
    )
    const report = await Effect.runPromise(evaluateDualSignalResearch(request).pipe(Effect.provide(layers)))
    expect(report.costs.coverage).toBe('INCOMPLETE')
    expect(report.comparison.status).toBe('INCOMPLETE')
    expect(report.numerical).toEqual({ status: 'UNAVAILABLE', failure: JevFailure.Timeout })
    expect(report.tradingAuthority).toBe('NONE')
  })

  test('a sealed symbol mismatch prevents both provider dispatches', async () => {
    const outcome = await Effect.runPromise(
      evaluateDualSignalResearch(request, 'NVDA').pipe(Effect.provide(providers()), Effect.result),
    )
    expect(Result.isFailure(outcome)).toBe(true)
  })
})

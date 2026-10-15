import { describe, expect, test } from 'bun:test'
import { Clock, Effect, Fiber, Logger, Option, References, Result, Tracer } from 'effect'
import { TestClock } from 'effect/testing'
import { NodeServices } from '@effect/platform-node'

import { CycleState, type AutonomousCycle } from '../cycle'
import { retryableOperationalError, operationalError } from '../errors'
import { IntradaySnapshotFailure, type IntradayMarketDataService } from '../market-data'
import { CandidateObservationStore } from '../observe-composition/candidate-observation'
import { makeIntradayMomentumTestSnapshot } from '../strategy/intraday-momentum/test-support'
import { streamingFixtureFromRaw } from '../testing/streaming-market-fixture'
import { JevBatchExpired, JevBatchStore } from './batch-evaluation'
import { JevClient } from './client'
import { JevEvaluationStore } from './evaluation'
import { JevExitReason } from './exit'
import { nativeJevBatchResult, nativeJevDecisionEvidence, nativeJevFixture } from './native.test-support'
import { JevPositionStore, JevPurpose } from './portfolio'
import { evaluateJevObservation, evaluateJevPositionManagement } from './runtime'
import { utcInstantFromEpochMillis } from '../time'
import { canonicalHashV1 } from '../hash'
import { reconciledStateHash } from '../reconciliation'
import { defaultJevProtocolDocument } from './protocol'

const scenario = (
  options: {
    readonly symbol?: string
    readonly consumed?: boolean
    readonly pending?: boolean
    readonly protective?: boolean
    readonly maximumHold?: boolean
    readonly storeFailure?: boolean
    readonly mismatchedWindow?: boolean
    readonly observedAt?: string
    readonly firstFillAt?: string
    readonly laterFillAt?: string
    readonly pricingUnavailable?: boolean
    readonly snapshotPending?: boolean
    readonly completedHold?: boolean
    readonly inferenceDelayMs?: number
    readonly stalledInference?: boolean
    readonly advanceMs?: number
    readonly brokerEvidenceAgeMs?: number
    readonly interruptionDelayMs?: number
    readonly expiredObservation?: boolean
    readonly entryCutoffAt?: string
    readonly modelExit?: boolean
  } = {},
) => {
  const fixture = nativeJevFixture(JevPurpose.Manage, options.observedAt ?? '2026-09-04T14:30:32.000Z')
  const original = fixture.portfolio
  if (original.purpose !== JevPurpose.Manage) throw new Error('Expected held-position fixture')
  let brokerState = original.brokerState
  if (options.symbol !== undefined) {
    const positions = brokerState.positions.map((position) => ({
      ...position,
      symbol: options.symbol ?? position.symbol,
      quantityAtoms: '4987500000',
    }))
    const material = {
      ...brokerState,
      positions,
      orders: brokerState.orders.map((order) => ({ ...order, symbol: options.symbol ?? order.symbol })),
    }
    const stateHash = Result.getOrThrow(reconciledStateHash(material))
    brokerState = {
      ...material,
      reconciliation: { ...material.reconciliation, expectedHash: stateHash, observedHash: stateHash },
    }
  }
  if (options.brokerEvidenceAgeMs !== undefined) {
    const at = utcInstantFromEpochMillis(
      Date.parse(fixture.observation.payload.observedAt) - options.brokerEvidenceAgeMs,
    )
    const material = {
      account: { ...brokerState.account, observedAt: at },
      positions: brokerState.positions.map((position) => ({ ...position, observedAt: at })),
      positionsObservedAt: at,
      orders: brokerState.orders.map((order) => ({ ...order, observedAt: at })),
      ordersObservedAt: at,
      accountingHash: brokerState.accountingHash,
    }
    const stateHash = Result.getOrThrow(reconciledStateHash(material))
    brokerState = {
      ...material,
      unknownOrderCount: brokerState.unknownOrderCount,
      reconciliation: {
        ...brokerState.reconciliation,
        expectedHash: stateHash,
        observedHash: stateHash,
        contentHash: canonicalHashV1(material),
        reconciledAt: at,
      },
    }
  }
  const portfolio = {
    ...original,
    brokerState,
    entryInventoryDebit:
      options.symbol === undefined
        ? original.entryInventoryDebit
        : { quantityAtoms: '12500000', costBasisMicros: '1250000' },
    entryFills: options.maximumHold
      ? original.entryFills.map((fill) => ({ ...fill, occurredAt: '2026-09-04T14:15:32.000Z' }))
      : original.entryFills.map((fill, index) => ({
          ...fill,
          symbol: options.symbol ?? fill.symbol,
          occurredAt: (index === 0 ? options.firstFillAt : options.laterFillAt) ?? fill.occurredAt,
        })),
  }
  const cycle: AutonomousCycle = {
    ...fixture.draft,
    window: {
      ...fixture.draft.window,
      submissionCutoffAt: options.entryCutoffAt ?? fixture.draft.window.submissionCutoffAt,
    },
    state: CycleState.Active,
    bindings: {},
    stateVersion: 1,
    createdAt: fixture.observation.payload.observedAt,
    updatedAt: fixture.observation.payload.observedAt,
  }
  const calls = { pricing: 0, signal: 0, pending: 0, finish: 0, window: 0 }
  let inferenceInterrupted = 0
  const databaseFailure = operationalError({ component: 'database', operation: 'window', message: 'test failure' })
  const marketData: IntradayMarketDataService = {
    check: Effect.void,
    verifyReference: () => Effect.die('Unexpected reference read'),
    loadSnapshot: (query) =>
      Effect.suspend(() => {
        if (query.purpose === undefined) {
          calls.signal += 1
          if (options.completedHold || options.expiredObservation) return Effect.succeed(fixture.snapshot)
          if (options.snapshotPending)
            return Effect.fail(
              operationalError({
                component: 'market-data',
                operation: 'snapshot',
                message: 'signal archive incomplete',
                cause: new IntradaySnapshotFailure({ reason: 'not-ready', message: 'signal archive incomplete' }),
              }),
            )
          if (options.mismatchedWindow)
            return Effect.succeed({
              ...fixture.snapshot,
              manifest: {
                ...fixture.snapshot.manifest,
                rangeEndAt: '2026-09-04T14:29:00.000Z',
              },
            })
          return Effect.fail(
            retryableOperationalError({
              component: 'market-data',
              operation: 'snapshot',
              message: 'signal history unavailable',
            }),
          )
        }
        calls.pricing += 1
        if (options.pricingUnavailable)
          return Effect.fail(
            retryableOperationalError({
              component: 'market-data',
              operation: 'snapshot',
              message: 'execution quote unavailable',
            }),
          )
        return Effect.succeed(
          streamingFixtureFromRaw(
            makeIntradayMomentumTestSnapshot(
              fixture.protocol,
              { ...query, archiveWatermarks: [] },
              { AAPL: options.protective ? -0.02 : 0.02 },
            ),
            query,
          ).snapshot,
        )
      }),
  }
  const pendingEvidence = nativeJevDecisionEvidence(fixture, 'hold')
  const program = evaluateJevPositionManagement({
    cycle,
    entryDecisionHash: portfolio.entryDecisionHash,
    authorityGenerationHash: fixture.observation.payload.authorityGenerationHash,
    protocol: fixture.protocol,
    calendar: fixture.snapshot.manifest.calendar,
    brokerState: portfolio.brokerState,
    marketData,
  }).pipe(
    Effect.provideService(JevPositionStore, { read: () => Effect.succeed(portfolio) }),
    Effect.provideService(CandidateObservationStore, {
      record: () =>
        options.expiredObservation
          ? TestClock.adjust(fixture.protocol.inferenceValidityMs)
          : options.completedHold
            ? Effect.void
            : Effect.die('Unexpected observation write'),
      latestJevWindowEnd: () =>
        Effect.suspend(() => {
          calls.window += 1
          return options.storeFailure
            ? Effect.fail(databaseFailure)
            : Effect.succeed(
                options.consumed === false ? Option.none() : Option.some(fixture.snapshot.manifest.rangeEndAt),
              )
        }),
    }),
    Effect.provideService(JevBatchStore, {
      pending: () =>
        Effect.sync(() => {
          calls.pending += 1
          return options.pending ? ['pending'] : []
        }),
      finish: () =>
        Effect.sync(() => {
          calls.finish += 1
          return { plan: pendingEvidence.batchPlan, result: null }
        }),
      read: () => Effect.die('Unexpected batch read'),
      begin: (plan) =>
        options.completedHold
          ? Effect.gen(function* () {
              if (options.stalledInference)
                return yield* Effect.never.pipe(
                  Effect.onInterrupt(() =>
                    Effect.gen(function* () {
                      inferenceInterrupted++
                      if (options.interruptionDelayMs !== undefined)
                        yield* TestClock.adjust(options.interruptionDelayMs)
                    }),
                  ),
                )
              const result = nativeJevBatchResult(plan, fixture.observation.payload.observedAt, () =>
                options.modelExit ? 'exit' : 'hold',
              )
              if (options.inferenceDelayMs !== undefined) yield* TestClock.adjust(options.inferenceDelayMs)
              return { plan, result }
            })
          : options.expiredObservation
            ? Clock.currentTimeMillis.pipe(
                Effect.flatMap((now) =>
                  Effect.fail(
                    new JevBatchExpired({
                      batchId: plan.batchId,
                      cycleId: plan.cycleId,
                      observedAt: plan.observedAt,
                      expiresAt: plan.expiresAt,
                      checkedAt: utcInstantFromEpochMillis(now),
                    }),
                  ),
                ),
              )
            : Effect.die('Unexpected inference batch'),
    }),
    Effect.provideService(JevEvaluationStore, {
      read: () => Effect.die('Unexpected evaluation read'),
      begin: () => Effect.die('Unexpected evaluation claim'),
      record: () => Effect.die('Unexpected evaluation write'),
      abandon: () => Effect.die('Unexpected evaluation abandonment'),
    }),
    Effect.provideService(JevClient, { evaluate: () => Effect.die('Unexpected provider call') }),
  )
  const run = () =>
    Effect.runPromise(
      TestClock.setTime(Date.parse(fixture.observation.payload.observedAt)).pipe(
        Effect.andThen(
          options.stalledInference
            ? Effect.gen(function* () {
                const run = yield* program.pipe(Effect.forkChild({ startImmediately: true }))
                yield* TestClock.adjust(options.advanceMs ?? 7_000)
                return yield* Fiber.join(run)
              })
            : program,
        ),
        Effect.provide(TestClock.layer()),
        Effect.provide(NodeServices.layer),
      ),
    )
  return { calls, run, inferenceInterruptions: () => inferenceInterrupted }
}

describe('Jev management observation admission', () => {
  test('continues model management after the entry deadline while the position hold remains valid', async () => {
    const check = scenario({ consumed: false, completedHold: true, entryCutoffAt: '2026-09-04T14:30:00.000Z' })
    expect(await check.run()).toMatchObject({ _tag: 'Wait', details: { waitReason: 'JEV_POSITION_HELD' } })
    expect(check.calls.signal).toBe(1)
  })
  test('commits a model exit after the entry deadline within the same execution session', async () => {
    const check = scenario({
      consumed: false,
      completedHold: true,
      modelExit: true,
      entryCutoffAt: '2026-09-04T14:30:00.000Z',
    })
    expect(await check.run()).toMatchObject({ _tag: 'Exit', target: { reason: JevExitReason.Model } })
    expect(check.calls.signal).toBe(1)
  })
  test.each([
    ['consumed signal', {}, 'SIGNAL_WINDOW_OBSERVED'],
    ['pending inference', { pending: true }, 'DECISION_PENDING'],
    ['unavailable signal', { consumed: false }, 'SNAPSHOT_UNAVAILABLE'],
    ['incomplete signal archive', { consumed: false, snapshotPending: true }, 'SNAPSHOT_UNAVAILABLE'],
    ['unavailable execution quote', { pricingUnavailable: true }, 'SNAPSHOT_UNAVAILABLE'],
  ] as const)('retains the first partial-fill hold deadline while waiting for %s', async (_name, options, reason) => {
    const check = scenario({
      ...options,
      firstFillAt: '2026-09-04T14:15:39.000Z',
      laterFillAt: '2026-09-04T14:27:32.000Z',
    })
    expect(await check.run()).toMatchObject({
      _tag: 'Wait',
      details: {
        maximumHoldDueAt: '2026-09-04T14:30:39.000Z',
        maximumHoldEvaluatedAt: '2026-09-04T14:30:32.000Z',
        readiness: { reason },
      },
    })
  })

  test('retains the hold deadline through the completed-minute pricing wait', async () => {
    const check = scenario({
      observedAt: '2026-09-04T14:30:00.000Z',
      firstFillAt: '2026-09-04T14:15:07.000Z',
      laterFillAt: '2026-09-04T14:27:00.000Z',
    })
    expect(await check.run()).toMatchObject({
      _tag: 'Wait',
      details: {
        maximumHoldDueAt: '2026-09-04T14:30:07.000Z',
        maximumHoldEvaluatedAt: '2026-09-04T14:30:00.000Z',
        readiness: { reason: 'LOOKBACK_WARMUP', availableAt: '2026-09-04T14:30:00.001Z' },
      },
    })
    expect(check.calls).toEqual({ pricing: 0, signal: 0, pending: 0, finish: 0, window: 0 })
  })

  test('a complete model hold keeps the same actual first-fill deadline', async () => {
    const check = scenario({
      consumed: false,
      completedHold: true,
      firstFillAt: '2026-09-04T14:15:39.000Z',
      laterFillAt: '2026-09-04T14:27:32.000Z',
    })
    expect(await check.run()).toEqual({
      _tag: 'Wait',
      details: {
        waitReason: 'JEV_POSITION_HELD',
        maximumHoldDueAt: '2026-09-04T14:30:39.000Z',
        maximumHoldEvaluatedAt: '2026-09-04T14:30:32.000Z',
      },
    })
    expect(check.calls).toEqual({ pricing: 1, signal: 1, pending: 1, finish: 0, window: 1 })
  })

  test('a slow inference wait exits when it crosses the holding deadline', async () => {
    const check = scenario({
      consumed: false,
      completedHold: true,
      inferenceDelayMs: 11_000,
      firstFillAt: '2026-09-04T14:15:39.000Z',
      laterFillAt: '2026-09-04T14:27:32.000Z',
    })
    expect(await check.run()).toMatchObject({
      _tag: 'Exit',
      target: { reason: JevExitReason.MaximumHold },
    })
  })

  test('the holding deadline cancels stalled inference exactly once and exits', async () => {
    const check = scenario({
      consumed: false,
      completedHold: true,
      stalledInference: true,
      firstFillAt: '2026-09-04T14:15:39.000Z',
    })
    expect(await check.run()).toMatchObject({
      _tag: 'Exit',
      target: {
        reason: JevExitReason.MaximumHold,
        observedAt: '2026-09-04T14:30:39.000Z',
      },
    })
    expect(check.inferenceInterruptions()).toBe(1)
  })

  test('long-stalled management returns at inference validity before the holding deadline and broker expiry', async () => {
    const check = scenario({
      consumed: false,
      completedHold: true,
      stalledInference: true,
      advanceMs: 10_000,
      firstFillAt: '2026-09-04T14:17:32.000Z',
    })
    expect(await check.run()).toMatchObject({
      _tag: 'Wait',
      details: {
        maximumHoldDueAt: '2026-09-04T14:32:32.000Z',
        readiness: { reason: 'INFERENCE_UNAVAILABLE' },
      },
    })
    expect(check.inferenceInterruptions()).toBe(1)
  })

  test('nearly expired broker evidence ends management before its strict freshness boundary', async () => {
    const check = scenario({
      consumed: false,
      completedHold: true,
      stalledInference: true,
      advanceMs: 999,
      brokerEvidenceAgeMs: 59_000,
      firstFillAt: '2026-09-04T14:15:39.000Z',
    })
    expect(await check.run()).toMatchObject({
      _tag: 'Wait',
      details: {
        maximumHoldDueAt: '2026-09-04T14:30:39.000Z',
        readiness: { reason: 'INFERENCE_UNAVAILABLE' },
      },
    })
    expect(check.inferenceInterruptions()).toBe(1)
  })

  test('slow cancellation requires reconciliation rather than an exit from stale broker evidence', async () => {
    const check = scenario({
      consumed: false,
      completedHold: true,
      stalledInference: true,
      interruptionDelayMs: 60_000,
      firstFillAt: '2026-09-04T14:15:39.000Z',
    })
    expect(await check.run()).toMatchObject({
      _tag: 'Wait',
      details: {
        maximumHoldDueAt: '2026-09-04T14:30:39.000Z',
        waitReason: 'JEV_POSITION_AWAITING_RECONCILIATION',
      },
    })
    expect(check.inferenceInterruptions()).toBe(1)
  })

  test.each(['2026-09-04T14:30:39.000Z', '2026-09-04T14:30:40.000Z'])(
    'the maximum-hold guard runs at %s without a quote or another signal window',
    async (observedAt) => {
      const check = scenario({
        observedAt,
        firstFillAt: '2026-09-04T14:15:39.000Z',
        laterFillAt: '2026-09-04T14:27:32.000Z',
        pending: true,
        pricingUnavailable: true,
      })
      expect(await check.run()).toMatchObject({
        _tag: 'Exit',
        target: { reason: JevExitReason.MaximumHold, observedAt },
      })
      expect(check.calls).toEqual({ pricing: 0, signal: 0, pending: 0, finish: 0, window: 0 })
    },
  )

  test('a consumed minute checks protection without loading its full signal history', async () => {
    const check = scenario()
    expect(await check.run()).toMatchObject({
      _tag: 'Wait',
      details: { readiness: { reason: 'SIGNAL_WINDOW_OBSERVED', availableAt: '2026-09-04T14:31:02.000Z' } },
    })
    expect(check.calls).toEqual({ pricing: 1, signal: 0, pending: 1, finish: 0, window: 1 })
  })

  test('pending inference recovery precedes the full signal read', async () => {
    const check = scenario({ pending: true })
    expect(await check.run()).toMatchObject({ _tag: 'Wait', details: { readiness: { reason: 'DECISION_PENDING' } } })
    expect(check.calls).toEqual({ pricing: 1, signal: 0, pending: 1, finish: 1, window: 0 })
  })

  test('a fresh minute still requires source evidence and preserves its unavailability', async () => {
    const check = scenario({ consumed: false })
    expect(await check.run()).toMatchObject({
      _tag: 'Wait',
      details: { readiness: { reason: 'SNAPSHOT_UNAVAILABLE' } },
    })
    expect(check.calls).toEqual({ pricing: 1, signal: 1, pending: 1, finish: 0, window: 1 })
  })

  test('an observation committed after its inference deadline waits without failing position management', async () => {
    const check = scenario({ consumed: false, expiredObservation: true })
    expect(await check.run()).toMatchObject({
      _tag: 'Wait',
      details: { readiness: { reason: 'INFERENCE_UNAVAILABLE' } },
    })
    expect(check.calls).toEqual({ pricing: 1, signal: 1, pending: 1, finish: 0, window: 1 })
  })

  test.each([
    [JevPurpose.Entry, 'current', defaultJevProtocolDocument],
    [JevPurpose.Manage, 'current', defaultJevProtocolDocument],
    [JevPurpose.Entry, 'single-candidate', { ...defaultJevProtocolDocument, candidateSymbols: ['AAPL'] }],
  ] as const)(
    '%s %s retains typed expiry and structured admission diagnostics',
    async (purpose, _label, protocolDocument) => {
      const fixture = nativeJevFixture(purpose, '2026-09-04T14:30:32.000Z', undefined, protocolDocument)
      const spans: Tracer.NativeSpan[] = []
      const tracer = Tracer.make({
        span: (options) => {
          const span = new Tracer.NativeSpan(options)
          spans.push(span)
          return span
        },
      })
      const logs: { message: unknown; annotations: Readonly<Record<string, unknown>> }[] = []
      const logger = Logger.make(({ message, fiber }) => {
        logs.push({ message, annotations: fiber.getRef(References.CurrentLogAnnotations) })
      })
      const result = await Effect.runPromise(
        TestClock.setTime(Date.parse(fixture.observation.payload.observedAt)).pipe(
          Effect.andThen(
            evaluateJevObservation({
              cycleId: fixture.observation.payload.cycleId,
              authorityGenerationHash: fixture.observation.payload.authorityGenerationHash,
              protocol: fixture.protocol,
              portfolio: fixture.portfolio,
              snapshot: fixture.snapshot,
            }),
          ),
          Effect.result,
          Effect.provideService(CandidateObservationStore, {
            record: () => TestClock.adjust(fixture.protocol.inferenceValidityMs + 100),
            latestJevWindowEnd: () => Effect.succeed(Option.none()),
          }),
          Effect.provideService(JevBatchStore, {
            pending: () => Effect.succeed([]),
            read: () => Effect.die('No batch was recorded'),
            finish: () => Effect.die('An expired admission cannot finalize an unrecorded batch'),
            begin: (plan) =>
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((now) =>
                  Effect.fail(
                    new JevBatchExpired({
                      batchId: plan.batchId,
                      cycleId: plan.cycleId,
                      observedAt: plan.observedAt,
                      expiresAt: plan.expiresAt,
                      checkedAt: utcInstantFromEpochMillis(now),
                    }),
                  ),
                ),
              ),
          }),
          Effect.provideService(JevEvaluationStore, {
            read: () => Effect.die('No request can exist'),
            begin: () => Effect.die('No request can be claimed'),
            record: () => Effect.die('No inference can be recorded'),
            abandon: () => Effect.die('No inference can be abandoned'),
          }),
          Effect.provideService(JevClient, { evaluate: () => Effect.die('No provider call is allowed') }),
          Effect.provide(TestClock.layer()),
          Effect.provide(Logger.layer([logger])),
          Effect.provide(NodeServices.layer),
          Effect.provideService(Tracer.Tracer, tracer),
        ),
      )
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result))
        expect(result.failure).toMatchObject({ _tag: 'JevAwaitingEvidence', readiness: 'INFERENCE_UNAVAILABLE' })
      const warning = logs.find(
        ({ message }) => Array.isArray(message) && message[0] === 'Jev observation expired before batch admission',
      )
      expect(warning?.annotations).toMatchObject({
        batchId: expect.stringMatching(/^[0-9a-f]{64}$/),
        cycleId: fixture.observation.payload.cycleId,
        observedAt: fixture.observation.payload.observedAt,
        expiresAt: utcInstantFromEpochMillis(
          Date.parse(fixture.observation.payload.observedAt) + fixture.protocol.inferenceValidityMs,
        ),
        checkedAt: utcInstantFromEpochMillis(
          Date.parse(fixture.observation.payload.observedAt) + fixture.protocol.inferenceValidityMs + 100,
        ),
        admissionLagMs: fixture.protocol.inferenceValidityMs + 100,
      })
      const planning = spans.find((span) => span.name === 'bayn.jev.batch-plan')
      expect(planning?.attributes.get('bayn.entry_timing.input_available_at')).toBe(
        fixture.observation.payload.observedAt,
      )
      expect(planning?.attributes.get('bayn.entry_timing.snapshot_hash')).toBe(fixture.snapshot.manifest.contentHash)
      expect(planning?.attributes.get('bayn.entry_timing.batch_id')).toMatch(/^[0-9a-f]{64}$/)
      expect(planning?.attributes.get('bayn.entry_timing.observation_hash')).toBe(fixture.observation.contentHash)
      if (purpose === JevPurpose.Entry)
        expect(planning?.attributes.get('bayn.entry_timing.deterministic_selected_at')).toBe(
          warning?.annotations['checkedAt'],
        )
      else expect(planning?.attributes.has('bayn.entry_timing.deterministic_selected_at')).toBe(false)
    },
  )

  test.each([
    [JevExitReason.ProtectiveStop, { protective: true }, 1],
    [JevExitReason.MaximumHold, { maximumHold: true }, 0],
  ] as const)('%s remains eligible before observation admission', async (reason, options, pricing) => {
    const check = scenario(options)
    expect(await check.run()).toMatchObject({ _tag: 'Exit', target: { reason } })
    expect(check.calls).toEqual({ pricing, signal: 0, pending: 0, finish: 0, window: 0 })
  })

  test('a failed durable window read cannot become a successful wait', async () => {
    const check = scenario({ storeFailure: true })
    const failure = await check.run().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ message: expect.stringContaining('test failure') })
    expect(check.calls.signal).toBe(0)
  })

  test('a different returned signal window cannot use the admitted window', async () => {
    const check = scenario({ consumed: false, mismatchedWindow: true })
    const failure = await check.run().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).toMatchObject({ message: expect.stringContaining('differs from its admitted window') })
    expect(check.calls).toEqual({ pricing: 1, signal: 1, pending: 1, finish: 0, window: 1 })
  })
})

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD']) {
  test(`${symbol} recovers an overdue position from the prior UTC day before any model or market-data dependency`, async () => {
    const check = scenario({
      symbol,
      firstFillAt: '2026-09-03T23:50:00.000Z',
      pending: true,
      pricingUnavailable: true,
      storeFailure: true,
    })
    const result = await check.run()
    expect(result).toMatchObject({
      _tag: 'Exit',
      target: { reason: JevExitReason.MaximumHold, symbols: [symbol], targetWeights: { [symbol]: 0 } },
    })
    expect(check.calls).toEqual({ pricing: 0, signal: 0, pending: 0, finish: 0, window: 0 })
  })
}
test('an overdue position with expired broker evidence waits for reconciliation before authorizing a sell', async () => {
  const check = scenario({ maximumHold: true, brokerEvidenceAgeMs: 60_000, pending: true, pricingUnavailable: true })
  expect(await check.run()).toMatchObject({
    _tag: 'Wait',
    details: { waitReason: 'JEV_POSITION_AWAITING_RECONCILIATION' },
  })
  expect(check.calls).toEqual({ pricing: 0, signal: 0, pending: 0, finish: 0, window: 0 })
})

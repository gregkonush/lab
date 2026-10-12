import { Clock, Effect, Exit, Result, type Scope } from 'effect'

import { canonicalHashV1Result } from '../hash'
import type { KafkaMarketFailure, KafkaProjectionRead } from '../market-data/streaming/kafka'
import type { StreamingUniverse } from '../market-data/streaming/raw-events'
import {
  CaptureInvalidation,
  ResearchCaptureFailure,
  type CaptureIntervalCut,
  type CaptureIntervalRequest,
  type ResearchCaptureObserver,
  type ResearchCaptureSeal,
} from './capture'
import type { ResearchCaptureObjectStore } from './export'
import { makeResearchCaptureRecorder, type ResearchCaptureRecorder, type ResearchCaptureStore } from './recorder'
import type { ResearchCaptureSessionConfig } from './session-config'
import { captureResearchOpportunity, researchScheduleIdentity } from './opportunity'

interface SessionProjection {
  readonly captureInterval: (request: CaptureIntervalRequest) => Effect.Effect<CaptureIntervalCut, KafkaMarketFailure>
  readonly read: Effect.Effect<KafkaProjectionRead, KafkaMarketFailure>
}
type SessionState =
  | { readonly phase: 'waiting' | 'acquiring' }
  | {
      readonly phase: 'recording'
      readonly recorder: ResearchCaptureRecorder
      projection?: SessionProjection
      epoch?: string
      bootstrapped: boolean
    }
  | { readonly phase: 'finished'; readonly reason?: CaptureInvalidation; readonly seal?: ResearchCaptureSeal }

export const makeResearchCaptureSession = (config: ResearchCaptureSessionConfig, sourceRevision: string) =>
  Effect.gen(function* () {
    const clock = yield* Clock.Clock
    const {
      captureId: _captureId,
      sessionDate: _sessionDate,
      calendar: _calendar,
      researchSchedule: _schedule,
      ...declaration
    } = config
    const request: CaptureIntervalRequest = {
      intervalId: config.intervalId,
      coverageStartMs: config.coverageStartMs,
      coverageEndMs: config.coverageEndMs,
      universeHash: config.universeHash,
      expectedPartitions: config.expectedPartitions,
    }
    let state: SessionState = { phase: 'waiting' }
    const isFinished = () => state.phase === 'finished'
    let lastNow = clock.currentTimeMillisUnsafe()
    let nextResearchOrdinal = 0
    const finish = (reason?: CaptureInvalidation) =>
      Effect.suspend(() => {
        if (state.phase === 'finished') return Effect.void
        const recorder = state.phase === 'recording' ? state.recorder : undefined
        state = { phase: 'finished', ...(reason === undefined ? {} : { reason }) }
        if (reason !== undefined) recorder?.invalidate(reason)
        return Effect.gen(function* () {
          const seal = recorder === undefined ? undefined : yield* recorder.finish
          state = {
            phase: 'finished',
            ...(reason === undefined ? {} : { reason }),
            ...(seal === undefined ? {} : { seal }),
          }
          yield* Effect.logInfo('Bayn research capture attempt finished').pipe(
            Effect.annotateLogs({
              captureId: config.captureId,
              qualification: 'UNQUALIFIED',
              controllerCoverage: 'UNKNOWN',
              reason: reason ?? 'native-input-cut',
              sealed: seal !== undefined,
            }),
          )
        })
      })
    const observer: ResearchCaptureObserver = {
      rawValues: true,
      record: (event, atMs, rawValue) => {
        if (state.phase !== 'recording') return
        const now = atMs ?? clock.currentTimeMillisUnsafe()
        if (now >= config.stopAtMs) {
          state.recorder.invalidate(CaptureInvalidation.Deadline)
          return
        }
        if (event.kind === 'consumer-boundary') {
          if (event.phase === 'STARTED') {
            if (state.epoch !== undefined) state.recorder.invalidate(CaptureInvalidation.WorkerReplaced)
            state.epoch = event.consumerEpoch
          }
          if (event.phase === 'BOOTSTRAPPED') {
            state.bootstrapped = true
            if (now > config.coverageStartMs) state.recorder.invalidate(CaptureInvalidation.MissedBootstrap)
          }
        }
        state.recorder.record(event, atMs, rawValue)
      },
      invalidate: (reason) => {
        if (state.phase === 'recording') state.recorder.invalidate(reason)
      },
    }
    const tick = Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      if (now < lastNow) return yield* finish(CaptureInvalidation.ClockReversed)
      lastNow = now
      if (state.phase === 'finished') return
      if (now >= config.stopAtMs) return yield* finish(CaptureInvalidation.Deadline)
      if (state.phase !== 'recording') {
        if (now >= config.bootstrapDeadlineMs) yield* finish(CaptureInvalidation.MissedBootstrap)
        return
      }
      const active = state
      const status = yield* active.recorder.status
      if (status.invalidations.length !== 0) return yield* finish(status.invalidations[0])
      if (now >= config.coverageStartMs && !active.bootstrapped)
        return yield* finish(CaptureInvalidation.MissedBootstrap)
      while (
        config.coverageStartMs + nextResearchOrdinal * config.researchSchedule.pollIntervalMs <= now &&
        config.coverageStartMs + nextResearchOrdinal * config.researchSchedule.pollIntervalMs < config.coverageEndMs
      ) {
        const scheduledAtMs = config.coverageStartMs + nextResearchOrdinal * config.researchSchedule.pollIntervalMs
        const cut =
          now >= scheduledAtMs + config.researchSchedule.pollIntervalMs || active.projection === undefined
            ? null
            : yield* active.projection.read.pipe(Effect.timeout(100), Effect.result)
        const observedAtMs = yield* Clock.currentTimeMillis
        active.recorder.record(
          captureResearchOpportunity(
            config,
            nextResearchOrdinal++,
            observedAtMs,
            cut !== null && Result.isSuccess(cut) ? cut.success : null,
          ),
          observedAtMs,
        )
      }
      if (now < config.coverageEndMs || active.projection === undefined) return
      const cut = yield* active.projection.captureInterval(request).pipe(
        Effect.timeoutOrElse({
          duration: Math.min(1000, config.stopAtMs - now),
          orElse: () =>
            Effect.fail(new ResearchCaptureFailure({ message: 'Capture cut did not finish before its deadline' })),
        }),
        Effect.result,
      )
      if (Result.isSuccess(cut)) yield* finish()
    })
    yield* Effect.gen(function* () {
      while (!isFinished()) {
        yield* tick
        if (!isFinished()) {
          const now = yield* Clock.currentTimeMillis
          const next = [
            config.bootstrapDeadlineMs,
            config.coverageStartMs,
            config.coverageEndMs,
            config.stopAtMs,
            config.coverageStartMs + nextResearchOrdinal * config.researchSchedule.pollIntervalMs,
          ].filter((deadline) => deadline > now)
          yield* Effect.sleep(
            Math.max(0, Math.min(1000, config.stopAtMs - now, ...next.map((deadline) => deadline - now))),
          )
        }
      }
    }).pipe(
      Effect.catchCause(() => finish(CaptureInvalidation.Finalization)),
      Effect.forkScoped,
    )
    yield* Effect.addFinalizer(() => finish(CaptureInvalidation.Interrupted))
    return {
      observer,
      get workerObserver(): ResearchCaptureObserver | undefined {
        return state.phase === 'recording' ? observer : undefined
      },
      status: Effect.sync(() => (state.phase === 'finished' ? state : { phase: state.phase })),
      start: <E>(
        store: ResearchCaptureStore,
        objects: Effect.Effect<ResearchCaptureObjectStore, E, Scope.Scope>,
        universe: StreamingUniverse,
      ) =>
        Effect.suspend(() => {
          if (state.phase !== 'waiting') return finish(CaptureInvalidation.WorkerReplaced)
          const now = clock.currentTimeMillisUnsafe()
          if (now < config.startAtMs) return finish(CaptureInvalidation.OutsideWindow)
          if (now >= config.bootstrapDeadlineMs) return finish(CaptureInvalidation.MissedBootstrap)
          const universeHash = Result.getOrUndefined(canonicalHashV1Result(universe))
          const protocol = config.researchSchedule.protocol
          if (
            universeHash === undefined ||
            universeHash !== config.universeHash ||
            universe.symbols.join(',') !== protocol.universe.join(',') ||
            universe.universeId !== protocol.universeId ||
            universe.universeSymbolHash !== protocol.universeSymbolHash ||
            universe.topics.bars !== protocol.sourceTopics.bars ||
            universe.topics.quotes !== protocol.sourceTopics.quotes ||
            universe.topics.trades !== protocol.sourceTopics.trades
          )
            return finish(CaptureInvalidation.InvalidEvent)
          state = { phase: 'acquiring' }
          return Effect.gen(function* () {
            const objectStore = yield* objects
            if (state.phase !== 'acquiring') return
            const acquiredAtMs = clock.currentTimeMillisUnsafe()
            if (acquiredAtMs < now) return yield* finish(CaptureInvalidation.ClockReversed)
            if (acquiredAtMs >= config.bootstrapDeadlineMs) return yield* finish(CaptureInvalidation.MissedBootstrap)
            const recorder = yield* makeResearchCaptureRecorder(
              store,
              {
                captureId: config.captureId,
                sourceRevision,
                maximumQueuedReceipts: 1024,
                maximumQueuedBytes: 4 * 1024 * 1024,
                maximumReceiptBytes: 64 * 1024,
                flushIntervalMs: 50,
                writeTimeoutMs: 1000,
                maximumObjectBytes: config.maximumObjectBytes,
                maximumSqlBytes: config.maximumSqlBytes,
                session: declaration,
              },
              objectStore,
            )
            if (isFinished()) {
              recorder.invalidate(CaptureInvalidation.MissedBootstrap)
              yield* recorder.finish
              return
            }
            state = { phase: 'recording', recorder, bootstrapped: false }
            recorder.record({
              kind: 'research-schedule',
              scheduleHash: researchScheduleIdentity(config),
              ...config.researchSchedule,
              sessionDate: config.sessionDate,
              calendar: config.calendar,
              calendarHash: config.calendarHash,
              coverageStartMs: config.coverageStartMs,
              coverageEndMs: config.coverageEndMs,
            })
            const status = yield* recorder.status
            if (!status.accepting || status.invalidations.length !== 0)
              return yield* finish(status.invalidations[0] ?? CaptureInvalidation.Finalization)
            yield* Effect.addFinalizer(() => finish(CaptureInvalidation.Interrupted))
          })
        }).pipe(
          Effect.onExit((exit) => (Exit.isFailure(exit) ? finish(CaptureInvalidation.Persistence) : Effect.void)),
          Effect.ignoreCause,
        ),
      bind: (projection: SessionProjection): void => {
        if (state.phase === 'recording') state.projection = projection
      },
    }
  })

export type ResearchCaptureSession = Effect.Success<ReturnType<typeof makeResearchCaptureSession>>

import { Result, Schema } from 'effect'
import { canonicalHashV1 } from '../hash'
import { JevProtocolSchema } from '../jev/protocol'
import { makeJevEntryQuery } from '../jev/observation-query'
import { jevMomentumEntryCandidates } from '../jev/trading-signals'
import { diagnoseStreamingInputs } from '../market-data/streaming/inputs'
import type { KafkaProjectionRead } from '../market-data/streaming/kafka'
import { constructStreamingSnapshot } from '../market-data/streaming/snapshot'
import { StreamingSnapshotEvidenceSchema } from '../market-data/streaming/evidence-schema'
import {
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  Sha256Schema,
  StrictNonEmptyStringSchema,
  SymbolSchema,
  UtcInstantSchema,
  UtcOrderTimestampSchema,
} from '../schemas'
import { utcInstantFromEpochMillis } from '../time'
import type { ResearchCaptureSessionConfig } from './session-config'
import { SnapshotCalendarSchema } from '../market-data/streaming/manifest-schema'
import { IsoDateSchema } from '../schemas'
import type { ResearchCaptureReceipt } from './capture'
import type { MarketCalendarObservation } from '../broker/alpaca/model'

type ResearchOpportunitySchedule = Pick<
  ResearchCaptureSessionConfig,
  'sessionDate' | 'calendarHash' | 'coverageStartMs' | 'coverageEndMs' | 'researchSchedule'
> & { readonly calendar: MarketCalendarObservation }

export const ResearchScheduleSchema = Schema.Struct({
  protocol: JevProtocolSchema,
  pollIntervalMs: PositiveIntegerSchema.check(Schema.isGreaterThanOrEqualTo(1000), Schema.isLessThanOrEqualTo(60_000)),
})

export const ResearchScheduleRegistrationSchema = Schema.Struct({
  kind: Schema.Literal('research-schedule'),
  scheduleHash: Sha256Schema,
  ...ResearchScheduleSchema.fields,
  sessionDate: IsoDateSchema,
  calendar: SnapshotCalendarSchema,
  coverageStartMs: NonNegativeIntegerSchema,
  coverageEndMs: NonNegativeIntegerSchema,
  calendarHash: Sha256Schema,
})

export enum ResearchOpportunityStatus {
  Warmup = 'WARMUP',
  Cutoff = 'CUTOFF',
  Missed = 'MISSED',
  InputUnavailable = 'INPUT_UNAVAILABLE',
  NoEligibleCandidate = 'NO_ELIGIBLE_CANDIDATE',
  Available = 'AVAILABLE',
}

const CandidateSchema = Schema.Struct({
  symbol: SymbolSchema,
  evidence: Schema.NullOr(
    Schema.Struct({
      eligibility: Schema.Union([
        Schema.Struct({ status: Schema.Literal('ELIGIBLE') }),
        Schema.Struct({
          status: Schema.Literal('EXCLUDED'),
          reason: Schema.Literals(['not-ready', 'freshness']),
          message: Schema.String,
        }),
      ]),
      window: Schema.Struct({
        startAt: UtcInstantSchema,
        endAt: UtcInstantSchema,
        requiredBarCount: NonNegativeIntegerSchema,
        observedBarCount: NonNegativeIntegerSchema,
        missingBarAt: Schema.Array(UtcInstantSchema),
      }),
      featureHash: Schema.NullOr(Sha256Schema),
      quote: Schema.NullOr(
        Schema.Struct({
          eventAt: Schema.Union([UtcInstantSchema, UtcOrderTimestampSchema]),
          ageMs: Schema.Finite,
          availableAtMs: NonNegativeIntegerSchema,
          sourceTopic: Schema.String,
          sourcePartition: NonNegativeIntegerSchema,
          sourceOffset: Schema.String,
        }),
      ),
    }),
  ),
})

export const ResearchOpportunitySchema = Schema.Struct({
  kind: Schema.Literal('research-opportunity'),
  scheduleHash: Sha256Schema,
  ordinal: NonNegativeIntegerSchema,
  scheduledAt: UtcInstantSchema,
  observedAt: UtcInstantSchema,
  status: Schema.Enum(ResearchOpportunityStatus),
  reason: Schema.NullOr(Schema.String),
  queryHash: Schema.NullOr(Sha256Schema),
  snapshotId: Schema.NullOr(Sha256Schema),
  snapshotHash: Schema.NullOr(Sha256Schema),
  inputCut: Schema.NullOr(
    Schema.Struct({
      consumerEpoch: StrictNonEmptyStringSchema,
      consumerSequence: NonNegativeIntegerSchema,
      projectionSequence: NonNegativeIntegerSchema,
      positions: StreamingSnapshotEvidenceSchema.fields.positions,
    }),
  ),
  momentumSymbols: Schema.Array(SymbolSchema),
  candidates: Schema.Array(CandidateSchema),
})
export type ResearchOpportunity = typeof ResearchOpportunitySchema.Type

export const researchScheduleIdentity = (config: ResearchOpportunitySchedule) =>
  canonicalHashV1({
    sessionDate: config.sessionDate,
    calendarHash: config.calendarHash,
    coverageStartMs: config.coverageStartMs,
    coverageEndMs: config.coverageEndMs,
    ...config.researchSchedule,
  })

export const captureResearchOpportunity = (
  config: ResearchOpportunitySchedule,
  ordinal: number,
  observedAtMs: number,
  cut: KafkaProjectionRead | null,
): ResearchOpportunity => {
  const { protocol, pollIntervalMs } = config.researchSchedule
  const scheduledAtMs = config.coverageStartMs + ordinal * pollIntervalMs
  const base = {
    kind: 'research-opportunity' as const,
    scheduleHash: researchScheduleIdentity(config),
    ordinal,
    scheduledAt: utcInstantFromEpochMillis(scheduledAtMs),
    observedAt: utcInstantFromEpochMillis(observedAtMs),
    queryHash: null,
    snapshotId: null,
    snapshotHash: null,
    inputCut: null,
    momentumSymbols: [],
    candidates: protocol.candidateSymbols.map((symbol) => ({ symbol, evidence: null })),
  }
  if (observedAtMs >= scheduledAtMs + pollIntervalMs)
    return {
      ...base,
      status: ResearchOpportunityStatus.Missed,
      reason: 'Research sampler missed this slot; no historical availability was inferred',
    }
  const query = makeJevEntryQuery({
    protocol,
    calendar: config.calendar,
    sessionDate: config.sessionDate,
    observedAtMs,
    candidates: protocol.candidateSymbols,
  })
  if (Date.parse(query.rangeStartAt) < config.coverageStartMs)
    return { ...base, status: ResearchOpportunityStatus.Warmup, reason: 'Rolling lookback is not complete' }
  if (observedAtMs >= config.coverageEndMs - protocol.entryCutoffMinutesBeforeClose * 60_000)
    return { ...base, status: ResearchOpportunityStatus.Cutoff, reason: 'Native entry cutoff elapsed' }
  if (cut === null)
    return { ...base, status: ResearchOpportunityStatus.InputUnavailable, reason: 'Research projection is unavailable' }
  const inputCut = {
    consumerEpoch: cut.projection.epoch,
    consumerSequence: cut.consumerSequence,
    projectionSequence: cut.projection.sequence,
    positions: cut.deliveredPositions,
  }
  const queryHash = canonicalHashV1(query)
  const inventory = diagnoseStreamingInputs(cut.projection, query)
  if (Result.isFailure(inventory))
    return {
      ...base,
      queryHash,
      inputCut,
      status: ResearchOpportunityStatus.InputUnavailable,
      reason: inventory.failure.message,
    }
  const candidates = inventory.success.candidates.map(({ symbol, matchingFeature, ...evidence }) => ({
    symbol,
    evidence: { ...evidence, featureHash: matchingFeature === null ? null : canonicalHashV1(matchingFeature) },
  }))
  const snapshot = constructStreamingSnapshot({ ...cut, positions: cut.deliveredPositions }, query)
  if (Result.isFailure(snapshot))
    return {
      ...base,
      queryHash,
      candidates,
      inputCut,
      status: candidates.every((candidate) => candidate.evidence.eligibility.status === 'EXCLUDED')
        ? ResearchOpportunityStatus.NoEligibleCandidate
        : ResearchOpportunityStatus.InputUnavailable,
      reason: snapshot.failure.message,
    }
  const momentum = jevMomentumEntryCandidates(snapshot.success, protocol)
  return {
    ...base,
    queryHash,
    candidates,
    inputCut,
    snapshotId: snapshot.success.manifest.snapshotId,
    snapshotHash: snapshot.success.manifest.contentHash,
    momentumSymbols: Result.isSuccess(momentum) ? momentum.success.map(({ symbol }) => symbol) : [],
    status: Result.isSuccess(momentum)
      ? ResearchOpportunityStatus.Available
      : ResearchOpportunityStatus.InputUnavailable,
    reason: Result.isFailure(momentum) ? `Native momentum selection failed: ${momentum.failure._tag}` : null,
  }
}

export const prepareResearchSchedule = (receipts: readonly ResearchCaptureReceipt[]) =>
  Result.gen(function* () {
    const registrations = receipts.filter((receipt) => receipt.event.kind === 'research-schedule')
    const registration = registrations[0]
    const opportunities = receipts.filter((receipt) => receipt.event.kind === 'research-opportunity')
    if (registrations.length === 0 && opportunities.length === 0)
      return {
        schedule: null,
        expectedCount: 0,
        observedCount: 0,
        missingOrdinals: [],
        opportunities: [] as (ResearchCaptureReceipt & { readonly event: ResearchOpportunity })[],
      }
    if (registrations.length !== 1 || registration?.event.kind !== 'research-schedule')
      return yield* Result.fail('Research capture must have one schedule registration')
    const schedule = registration.event
    const { normalizedResponseHash, ...calendarMaterial } = schedule.calendar
    const calendarSession = schedule.calendar.sessions.find(({ date }) => date === schedule.sessionDate)
    if (
      canonicalHashV1(calendarMaterial) !== normalizedResponseHash ||
      schedule.calendarHash !== normalizedResponseHash ||
      calendarSession === undefined ||
      schedule.coverageStartMs !== Date.parse(calendarSession.openAt) ||
      schedule.coverageEndMs !== Date.parse(calendarSession.closeAt) ||
      schedule.coverageEndMs - schedule.coverageStartMs > 24 * 60 * 60_000
    )
      return yield* Result.fail('Research schedule has no identical bounded calendar session')
    const expectedHash = canonicalHashV1({
      sessionDate: schedule.sessionDate,
      calendarHash: schedule.calendarHash,
      coverageStartMs: schedule.coverageStartMs,
      coverageEndMs: schedule.coverageEndMs,
      protocol: schedule.protocol,
      pollIntervalMs: schedule.pollIntervalMs,
    })
    if (expectedHash !== schedule.scheduleHash || schedule.coverageEndMs <= schedule.coverageStartMs)
      return yield* Result.fail('Research schedule identity or session bounds differ')
    const expectedCount = Math.ceil((schedule.coverageEndMs - schedule.coverageStartMs) / schedule.pollIntervalMs)
    const seen = new Set<number>()
    const retained: (ResearchCaptureReceipt & { readonly event: ResearchOpportunity })[] = []
    for (const receipt of opportunities) {
      if (receipt.event.kind !== 'research-opportunity') continue
      const event = receipt.event
      if (
        receipt.sequence <= registration.sequence ||
        event.scheduleHash !== expectedHash ||
        seen.has(event.ordinal) ||
        event.ordinal >= expectedCount ||
        event.scheduledAt !==
          utcInstantFromEpochMillis(schedule.coverageStartMs + event.ordinal * schedule.pollIntervalMs) ||
        event.observedAt < event.scheduledAt ||
        Date.parse(event.observedAt) > receipt.observedAtMs ||
        event.candidates.map(({ symbol }) => symbol).join(',') !== schedule.protocol.candidateSymbols.join(',')
      )
        return yield* Result.fail(
          'Research opportunity is duplicated, outside its schedule, or missing candidate identities',
        )
      seen.add(event.ordinal)
      const observedAtMs = Date.parse(event.observedAt)
      const missed = observedAtMs >= Date.parse(event.scheduledAt) + schedule.pollIntervalMs
      if (
        missed !== (event.status === ResearchOpportunityStatus.Missed) ||
        (event.status === ResearchOpportunityStatus.Available &&
          (event.snapshotId === null ||
            event.snapshotHash === null ||
            event.queryHash === null ||
            event.inputCut === null ||
            event.candidates.some(({ evidence }) => evidence === null))) ||
        ([
          ResearchOpportunityStatus.Missed,
          ResearchOpportunityStatus.Warmup,
          ResearchOpportunityStatus.Cutoff,
        ].includes(event.status) &&
          (event.queryHash !== null ||
            event.inputCut !== null ||
            event.snapshotHash !== null ||
            event.snapshotId !== null ||
            event.candidates.some(({ evidence }) => evidence !== null)))
      )
        return yield* Result.fail('Research disposition contradicts its observed timing or evidence')
      if (
        event.queryHash !== null &&
        event.queryHash !==
          canonicalHashV1(
            makeJevEntryQuery({
              protocol: schedule.protocol,
              calendar: schedule.calendar,
              sessionDate: schedule.sessionDate,
              observedAtMs,
              candidates: schedule.protocol.candidateSymbols,
            }),
          )
      )
        return yield* Result.fail('Research opportunity query differs from its registered protocol and observed clock')
      retained.push({ ...receipt, event })
    }
    const missingOrdinals = Array.from({ length: expectedCount }, (_, ordinal) => ordinal).filter(
      (ordinal) => !seen.has(ordinal),
    )
    return {
      schedule,
      expectedCount,
      observedCount: seen.size,
      missingOrdinals,
      opportunities: retained,
    }
  })

export const reproduceResearchOpportunity = (
  schedule: typeof ResearchScheduleRegistrationSchema.Type,
  opportunity: ResearchOpportunity,
  cut: KafkaProjectionRead | null,
) => {
  const reproduced = captureResearchOpportunity(
    { ...schedule, researchSchedule: { protocol: schedule.protocol, pollIntervalMs: schedule.pollIntervalMs } },
    opportunity.ordinal,
    Date.parse(opportunity.observedAt),
    cut,
  )
  return canonicalHashV1(reproduced) === canonicalHashV1(opportunity)
    ? Result.succeed(undefined)
    : Result.fail(`Research opportunity ${opportunity.ordinal} differs from its captured input prefix`)
}

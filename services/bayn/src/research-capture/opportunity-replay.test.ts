import { expect, test } from 'bun:test'
import { Result, Schema } from 'effect'
import { canonicalHashV1, sha256 } from '../hash'
import { nativeJevFixture } from '../jev/native.test-support'
import { KafkaBootstrapTimestampPolicy } from '../market-data/streaming/bootstrap'
import { SnapshotCalendarSchema } from '../market-data/streaming/manifest-schema'
import { kafkaCaptureDisposition } from '../market-data/streaming/kafka'
import { emptyStreamingProjection, incorporateMarketRecord } from '../market-data/streaming/projection'
import { historicalRawArrivals } from '../testing/historical-streaming-fixture'
import {
  CaptureQualification,
  ResearchCaptureFailure,
  captureKafkaTransport,
  encodeResearchCapture,
  type ResearchCaptureEvent,
} from './capture'
import {
  buildResearchCaptureExportChunk,
  deriveResearchCaptureExportManifest,
  verifyResearchCaptureExportPrefix,
} from './export'
import {
  captureResearchOpportunity,
  researchScheduleIdentity,
  ResearchOpportunityStatus,
  type ResearchOpportunity,
} from './opportunity'
import { replayResearchCaptureInterval } from './replay'

const native = nativeJevFixture()
const observedAtMs = Date.parse(native.query.observedAt)
const calendar = Result.getOrThrow(
  Schema.decodeUnknownResult(SnapshotCalendarSchema)(native.snapshot.manifest.calendar),
)
const session = calendar.sessions[0]
if (session === undefined) throw new Error('Missing fixture session')
const schedule = {
  sessionDate: native.query.sessionDate,
  calendar,
  calendarHash: calendar.normalizedResponseHash,
  coverageStartMs: Date.parse(session.openAt),
  coverageEndMs: Date.parse(session.closeAt),
  researchSchedule: { protocol: native.protocol, pollIntervalMs: 60_000 },
}
const universe = {
  universeId: native.protocol.universeId,
  universeSymbolHash: native.protocol.universeSymbolHash,
  symbols: native.protocol.universe,
  topics: { ...native.protocol.sourceTopics, features: native.protocol.streamingInput.featureTopic },
}
const assigned = native.cut.positions.map(({ topic, partition }) => ({ topic, partition, offset: '0' }))
const bootstrap = {
  ...native.cut.bootstrap,
  observedAtMs: schedule.coverageStartMs - 1,
  timestampPolicy: KafkaBootstrapTimestampPolicy.RetainedBeginning,
  partitions: assigned.map(({ topic, partition, offset }) => ({
    topic,
    partition,
    logStartOffset: offset,
    startOffset: offset,
    endOffset: offset,
  })),
}
const request = {
  intervalId: 'scheduled-session',
  coverageStartMs: schedule.coverageStartMs,
  coverageEndMs: schedule.coverageEndMs,
  universeHash: canonicalHashV1(universe),
  expectedPartitions: assigned.map(({ topic, partition }) => ({ topic, partition })),
}
type Row = { readonly event: ResearchCaptureEvent; readonly observedAtMs: number; readonly rawValue?: Uint8Array }
const rows: Row[] = []
const add = (event: ResearchCaptureEvent, at: number, rawValue?: Uint8Array) =>
  rows.push({ event, observedAtMs: at, ...(rawValue === undefined ? {} : { rawValue }) })
add(
  {
    kind: 'research-schedule',
    scheduleHash: researchScheduleIdentity(schedule),
    ...schedule.researchSchedule,
    sessionDate: schedule.sessionDate,
    calendar,
    calendarHash: schedule.calendarHash,
    coverageStartMs: schedule.coverageStartMs,
    coverageEndMs: schedule.coverageEndMs,
  },
  schedule.coverageStartMs - 3,
)
add(
  { kind: 'consumer-boundary', phase: 'STARTED', consumerEpoch: bootstrap.epoch, positions: [] },
  schedule.coverageStartMs - 2,
)
add(
  { kind: 'consumer-boundary', phase: 'ASSIGNED', consumerEpoch: bootstrap.epoch, positions: assigned, bootstrap },
  bootstrap.observedAtMs,
)
add(
  { kind: 'consumer-boundary', phase: 'BOOTSTRAPPED', consumerEpoch: bootstrap.epoch, positions: assigned },
  schedule.coverageStartMs,
)
let projection = emptyStreamingProjection(bootstrap.epoch)
let consumerSequence = 0
let positions = native.cut.positions
let activeCut: Parameters<typeof captureResearchOpportunity>[3] = null
const arrivals = [
  ...historicalRawArrivals(native.snapshot, observedAtMs),
  ...[...native.cut.projection.features.values()].flat().map((feature) => ({
    availableAtMs: observedAtMs,
    record: {
      topic: feature.topic,
      partition: feature.partition,
      offset: feature.offset,
      value: JSON.stringify(feature.value),
    },
  })),
].sort(
  (left, right) =>
    left.record.topic.localeCompare(right.record.topic) ||
    left.record.partition - right.record.partition ||
    Number(BigInt(left.record.offset) - BigInt(right.record.offset)),
)
const activeOrdinal = Math.floor((observedAtMs - schedule.coverageStartMs) / schedule.researchSchedule.pollIntervalMs)
for (let ordinal = 0; schedule.coverageStartMs + ordinal * 60_000 < schedule.coverageEndMs; ordinal++) {
  if (ordinal === activeOrdinal) {
    for (const arrival of arrivals) {
      const raw = Buffer.from(arrival.record.value)
      const payload = JSON.parse(arrival.record.value)
      const timestampMs = payload.computedAtMs ?? Date.parse(payload.ingestTs)
      const previous = projection
      projection = incorporateMarketRecord(projection, { ...arrival.record, timestampMs }, universe, observedAtMs)
      add(
        {
          kind: 'market-record',
          consumerEpoch: bootstrap.epoch,
          consumerSequence: ++consumerSequence,
          projectionSequence: projection.sequence,
          topic: arrival.record.topic,
          partition: arrival.record.partition,
          offset: arrival.record.offset,
          originalTransport: captureKafkaTransport(timestampMs),
          rawValueSha256: sha256(raw),
          rawByteLength: raw.byteLength,
          tombstone: false,
          bootstrap: false,
          disposition: kafkaCaptureDisposition(previous, projection),
        },
        observedAtMs,
        raw,
      )
    }
  }
  const at = ordinal === activeOrdinal ? observedAtMs : schedule.coverageStartMs + ordinal * 60_000
  if (ordinal === activeOrdinal)
    activeCut = { projection, consumerSequence, bootstrap, positions, deliveredPositions: positions }
  add(
    captureResearchOpportunity(
      schedule,
      ordinal,
      at,
      ordinal < activeOrdinal
        ? null
        : {
            projection,
            consumerSequence,
            bootstrap,
            positions,
            deliveredPositions: positions,
          },
    ),
    at,
  )
  if (ordinal === activeOrdinal) {
    const topic = universe.topics.features
    const terminal = positions.find((position) => position.topic === topic)?.offset
    if (terminal === undefined) throw new Error('Missing feature partition')
    const offset = String(BigInt(terminal) - 1n)
    const raw = Buffer.from('{')
    const record = { topic, partition: 0, offset, value: raw.toString('utf8') }
    const previous = projection
    projection = incorporateMarketRecord(projection, record, universe, at + 1)
    if (projection.sequence !== previous.sequence)
      throw new Error('Rejected duplicate must keep the projection sequence')
    add(
      {
        kind: 'market-record',
        consumerEpoch: bootstrap.epoch,
        consumerSequence: ++consumerSequence,
        projectionSequence: projection.sequence,
        topic,
        partition: 0,
        offset,
        originalTransport: captureKafkaTransport(undefined),
        rawValueSha256: sha256(raw),
        rawByteLength: raw.byteLength,
        tombstone: false,
        bootstrap: false,
        disposition: kafkaCaptureDisposition(previous, projection),
      },
      at + 1,
      raw,
    )
    positions = positions.map((position) =>
      position.topic === topic ? { ...position, offset: String(BigInt(offset) + 1n) } : position,
    )
  }
}
const futureTopic = universe.topics.features
const futurePosition = positions.find((position) => position.topic === futureTopic)
if (futurePosition === undefined) throw new Error('Missing future feature partition')
const futureOffset = String(BigInt(futurePosition.offset) + 4n)
const futureRaw = Buffer.from('{')
const futurePrevious = projection
projection = incorporateMarketRecord(
  projection,
  { topic: futureTopic, partition: 0, offset: futureOffset, value: futureRaw.toString('utf8') },
  universe,
  schedule.coverageEndMs - 1,
)
add(
  {
    kind: 'market-record',
    consumerEpoch: bootstrap.epoch,
    consumerSequence: ++consumerSequence,
    projectionSequence: projection.sequence,
    topic: futureTopic,
    partition: 0,
    offset: futureOffset,
    originalTransport: captureKafkaTransport(undefined),
    rawValueSha256: sha256(futureRaw),
    rawByteLength: futureRaw.byteLength,
    tombstone: false,
    bootstrap: false,
    disposition: kafkaCaptureDisposition(futurePrevious, projection),
  },
  schedule.coverageEndMs - 1,
  futureRaw,
)
positions = positions.map((position) =>
  position.topic === futureTopic ? { ...position, offset: String(BigInt(futureOffset) + 1n) } : position,
)
add(
  {
    kind: 'consumer-interval-cut',
    schemaVersion: 'bayn.native-visible-input-cut.v1',
    ...request,
    consumerEpoch: bootstrap.epoch,
    transport: {
      sdk: '@platformatic/kafka',
      version: '2.12.1',
      isolation: 'READ_COMMITTED',
      mode: 'MANUAL',
      fallback: 'FAIL',
      deserializationFailure: 'FAIL',
    },
    committedFence: {
      lookupStartedAtMs: schedule.coverageEndMs,
      lookupCompletedAtMs: schedule.coverageEndMs + 1,
      positions,
    },
    drainedPositions: positions,
    finalConsumerSequence: consumerSequence,
  },
  schedule.coverageEndMs + 2,
)

const seal = (selected: readonly Row[]) => {
  const retained = selected.map((row, index) => ({
    ...row,
    receipt: { sequence: index + 1, observedAtMs: row.observedAtMs, event: row.event },
  }))
  const metadata = encodeResearchCapture({
    schemaVersion: 'bayn.research-capture-chunk.v1',
    captureId: 'opportunity-replay',
    sourceRevision: 'a'.repeat(40),
    chunkOrdinal: 0,
    previousContentHash: null,
    receipts: retained.map(({ receipt }) => receipt),
  })
  const object = buildResearchCaptureExportChunk(
    metadata,
    retained.map(({ receipt, rawValue }) => ({ receipt, ...(rawValue === undefined ? {} : { rawValue }) })),
    null,
  )
  const sealBytes = encodeResearchCapture({
    schemaVersion: 'bayn.research-capture-seal.v1',
    qualification: CaptureQualification.Unqualified,
    captureId: 'opportunity-replay',
    sourceRevision: 'a'.repeat(40),
    closedAtMs: schedule.coverageEndMs + 3,
    observedReceipts: retained.length,
    persistedReceipts: retained.length,
    persistedChunks: 1,
    lastContentHash: metadata.contentHash,
    invalidations: [],
    exportRoot: {
      schemaVersion: 'bayn.research-capture-export-root.v3',
      exportedChunks: 1,
      lastChunkHash: object.contentHash,
    },
  })
  const manifest = Result.getOrThrow(deriveResearchCaptureExportManifest(sealBytes))
  const manifestBytes = { contentHash: manifest.contentHash, payload: Buffer.from(manifest.payload).toString('utf8') }
  Result.getOrThrow(verifyResearchCaptureExportPrefix([object], sealBytes, manifestBytes))
  return replayResearchCaptureInterval([object], sealBytes, manifestBytes, request, universe)
}

test('complete schedule inventory reproduces every opportunity from the exact raw consumer prefix', () => {
  const replay = Result.getOrThrow(seal(rows))
  expect(replay.researchSchedule.status).toBe('INVENTORY_COMPLETE')
  expect(replay.researchSchedule.observedCount).toBe(390)
  expect(replay.researchSchedule.missingOrdinals).toEqual([])
  const active = replay.researchSchedule.opportunities[activeOrdinal]
  expect(active?.status).toBe(ResearchOpportunityStatus.Available)
  expect(active?.momentumSymbols).toContain('AAPL')
})

const mutations: readonly (readonly [string, (event: ResearchOpportunity) => ResearchOpportunity])[] = [
  ['snapshot identity', (event) => ({ ...event, snapshotId: 'f'.repeat(64) })],
  ['snapshot content', (event) => ({ ...event, snapshotHash: 'f'.repeat(64) })],
  ['momentum selection', (event) => ({ ...event, momentumSymbols: [] })],
  [
    'candidate exclusion',
    (event) => ({
      ...event,
      candidates: event.candidates.map((candidate, index) =>
        index !== 0 || candidate.evidence === null
          ? candidate
          : {
              ...candidate,
              evidence: {
                ...candidate.evidence,
                eligibility: { status: 'EXCLUDED', reason: 'not-ready', message: 'forged exclusion' },
              },
            },
      ),
    }),
  ],
  [
    'feature receipt',
    (event) => ({
      ...event,
      candidates: event.candidates.map((candidate) =>
        candidate.evidence?.featureHash === null || candidate.evidence === null
          ? candidate
          : {
              ...candidate,
              evidence: { ...candidate.evidence, featureHash: 'f'.repeat(64) },
            },
      ),
    }),
  ],
  [
    'quote receipt',
    (event) => ({
      ...event,
      candidates: event.candidates.map((candidate) =>
        candidate.evidence?.quote === null || candidate.evidence === null
          ? candidate
          : {
              ...candidate,
              evidence: { ...candidate.evidence, quote: { ...candidate.evidence.quote, sourceOffset: '999999' } },
            },
      ),
    }),
  ],
  [
    'consumer epoch',
    (event) => ({
      ...event,
      inputCut: event.inputCut === null ? null : { ...event.inputCut, consumerEpoch: 'another-epoch' },
    }),
  ],
  [
    'uncaptured prefix',
    (event) => ({
      ...event,
      inputCut: event.inputCut === null ? null : { ...event.inputCut, consumerSequence: consumerSequence + 1 },
    }),
  ],
  [
    'future captured prefix',
    (event) => ({ ...event, inputCut: event.inputCut === null ? null : { ...event.inputCut, consumerSequence } }),
  ],
  [
    'wrong projection prefix',
    (event) => ({ ...event, inputCut: event.inputCut === null ? null : { ...event.inputCut, projectionSequence: 0 } }),
  ],
]
test.each(mutations)('resealing a changed %s does not make opportunity evidence valid', (_, mutate) => {
  const changed = rows.map((row) =>
    row.event.kind === 'research-opportunity' && row.event.ordinal === activeOrdinal
      ? { ...row, event: mutate(row.event) }
      : row,
  )
  expect(Result.isFailure(seal(changed))).toBeTrue()
})

test('resealing future partition positions and matching snapshot hashes cannot borrow later rejected deliveries', () => {
  if (activeCut === null) throw new Error('Missing active consumer cut')
  const forged = captureResearchOpportunity(schedule, activeOrdinal, observedAtMs, {
    ...activeCut,
    positions,
    deliveredPositions: positions,
  })
  const original = rows.find((row) => row.event.kind === 'research-opportunity' && row.event.ordinal === activeOrdinal)
  if (original?.event.kind !== 'research-opportunity') throw new Error('Missing original opportunity')
  expect(forged.snapshotHash).not.toBe(original.event.snapshotHash)
  const changed = rows.map((row) => (row === original ? { ...row, event: forged } : row))
  const result = seal(changed)
  expect(
    Result.isFailure(result) && result.failure instanceof ResearchCaptureFailure && result.failure.message,
  ).toContain('positions differ from its delivered prefix')
})

test('missing scheduled opportunities remain explicit after all retained evidence is reproduced', () => {
  const replay = Result.getOrThrow(
    seal(rows.filter((row) => row.event.kind !== 'research-opportunity' || row.event.ordinal !== 3)),
  )
  expect(replay.researchSchedule.status).toBe('INVENTORY_INCOMPLETE')
  expect(replay.researchSchedule.missingOrdinals).toEqual([3])
})

test('rejected records distinguish consumer prefixes with the same projection sequence', () => {
  const changed = rows.map((row) =>
    row.event.kind !== 'research-opportunity' || row.event.ordinal !== activeOrdinal + 1 || row.event.inputCut === null
      ? row
      : {
          ...row,
          event: {
            ...row.event,
            inputCut: { ...row.event.inputCut, consumerSequence: row.event.inputCut.consumerSequence - 1 },
          },
        },
  )
  const replay = seal(changed)
  expect(
    Result.isFailure(replay) && replay.failure instanceof ResearchCaptureFailure && replay.failure.message,
  ).toContain('differs from its captured input prefix')
})

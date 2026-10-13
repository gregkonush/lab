import { expect, test } from 'bun:test'
import { Result } from 'effect'
import { defaultJevProtocolDocument } from '../jev/protocol'
import { streamingFixture } from '../testing/streaming-market-fixture'
import { captureResearchOpportunity, ResearchOpportunityStatus, prepareResearchSchedule } from './opportunity'
import { sessionConfig } from './session.test-support'
import { constructStreamingSnapshot } from '../market-data/streaming/snapshot'
import { makeJevEntryQuery } from '../jev/observation-query'

const fixture = streamingFixture()
const config = {
  ...sessionConfig,
  sessionDate: fixture.query.sessionDate,
  calendar: fixture.query.calendar,
  coverageStartMs: Date.parse(fixture.query.calendar.sessions[0]?.openAt ?? ''),
  coverageEndMs: Date.parse(fixture.query.calendar.sessions[0]?.closeAt ?? ''),
  researchSchedule: {
    protocol: { ...defaultJevProtocolDocument, candidateSymbols: fixture.query.candidateSymbols ?? [] },
    pollIntervalMs: 1000,
  },
}
const observedAtMs = Date.parse(fixture.query.observedAt)
const ordinal = (observedAtMs - config.coverageStartMs) / 1000

test('position-independent research captures the full native inventory and immutable snapshot', () => {
  const event = captureResearchOpportunity(config, ordinal, observedAtMs, fixture.cut)
  expect(event.status).toBe(ResearchOpportunityStatus.Available)
  const snapshot = Result.getOrThrow(
    constructStreamingSnapshot(
      fixture.cut,
      makeJevEntryQuery({
        protocol: config.researchSchedule.protocol,
        calendar: config.calendar,
        sessionDate: config.sessionDate,
        observedAtMs,
        candidates: config.researchSchedule.protocol.candidateSymbols,
      }),
    ),
  )
  expect(event.snapshotHash).toBe(snapshot.manifest.contentHash)
  expect(event.candidates.map(({ symbol }) => symbol)).toEqual([...config.researchSchedule.protocol.candidateSymbols])
  expect(event.momentumSymbols).toContain('AAPL')
})

test('an all-excluded opportunity retains exact holes instead of disappearing', () => {
  const cut = {
    ...fixture.cut,
    projection: {
      ...fixture.cut.projection,
      features: new Map([...fixture.cut.projection.features].filter(([symbol]) => symbol === 'SPY')),
    },
  }
  const event = captureResearchOpportunity(config, ordinal, observedAtMs, cut)
  expect(event.status).toBe(ResearchOpportunityStatus.NoEligibleCandidate)
  expect(event.snapshotHash).toBeNull()
  expect(event.candidates.every(({ evidence }) => evidence?.eligibility.status === 'EXCLUDED')).toBeTrue()
  expect(event.candidates).toHaveLength(config.researchSchedule.protocol.candidateSymbols.length)
})

test('research snapshot provenance cannot borrow broker drain offsets beyond delivered records', () => {
  const brokerPositions = fixture.cut.positions.map((position) => ({
    ...position,
    offset: String(BigInt(position.offset) + 10n),
  }))
  const cut = {
    ...fixture.cut,
    positions: brokerPositions,
    bootstrap: {
      ...fixture.cut.bootstrap,
      partitions: fixture.cut.bootstrap.partitions.map((partition, index) => ({
        ...partition,
        endOffset: brokerPositions[index]?.offset ?? partition.endOffset,
      })),
    },
  }
  const event = captureResearchOpportunity(config, ordinal, observedAtMs, cut)
  expect(event.status).toBe(ResearchOpportunityStatus.InputUnavailable)
  expect(event.snapshotHash).toBeNull()
  expect(event.inputCut?.positions).toEqual(fixture.cut.deliveredPositions)
  expect(event.inputCut?.positions).not.toEqual(brokerPositions)
})

test('late slots never borrow a later snapshot and warmup/unavailable opportunities retain candidate identities', () => {
  const missed = captureResearchOpportunity(config, ordinal, observedAtMs + 1000, fixture.cut)
  expect(missed.status).toBe(ResearchOpportunityStatus.Missed)
  expect(missed.queryHash).toBeNull()
  expect(missed.snapshotHash).toBeNull()
  expect(captureResearchOpportunity(config, 0, config.coverageStartMs, fixture.cut).status).toBe(
    ResearchOpportunityStatus.Warmup,
  )
  const unavailable = captureResearchOpportunity(config, ordinal, observedAtMs, null)
  expect(unavailable.status).toBe(ResearchOpportunityStatus.InputUnavailable)
  expect(unavailable.candidates).toHaveLength(config.researchSchedule.protocol.candidateSymbols.length)
  expect(Result.getOrThrow(prepareResearchSchedule([])).schedule).toBeNull()
})

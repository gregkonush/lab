import type { MarketCalendarObservation } from '../broker/alpaca/model'
import type { IntradaySnapshotQuery } from '../market-data'
import { utcInstantFromEpochMillis } from '../time'
import type { JevProtocol } from './protocol'

export const makeJevEntryQuery = (input: {
  readonly protocol: JevProtocol
  readonly calendar: MarketCalendarObservation
  readonly sessionDate: IntradaySnapshotQuery['sessionDate']
  readonly observedAtMs: number
  readonly candidates: readonly string[]
}): IntradaySnapshotQuery => {
  const { protocol, candidates } = input
  const rangeEndMs = Math.floor((input.observedAtMs - protocol.decisionDelaySeconds * 1000) / 60_000) * 60_000
  return {
    sessionDate: input.sessionDate,
    calendar: input.calendar,
    observedAt: utcInstantFromEpochMillis(input.observedAtMs),
    rangeStartAt: utcInstantFromEpochMillis(rangeEndMs - protocol.lookbackMinutes * 60_000),
    rangeEndAt: utcInstantFromEpochMillis(rangeEndMs),
    universeId: protocol.universeId,
    universeSymbolHash: protocol.universeSymbolHash,
    universe: protocol.universe,
    symbols: [...candidates, protocol.benchmarkSymbol].sort(),
    candidateSymbols: candidates,
    ...(protocol.candidateEvidencePolicy === undefined
      ? {}
      : { candidateEvidencePolicy: protocol.candidateEvidencePolicy }),
    feed: protocol.feed,
    delayClass: protocol.delayClass,
    sourceTopics: protocol.sourceTopics,
    maximumQuoteAgeMs: protocol.maximumQuoteAgeMs,
    minimumWatermarkLagMs: protocol.decisionDelaySeconds * 1000,
  }
}

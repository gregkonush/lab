import { jevMarketForSymbol, jevBenchmarkSymbol } from './markets'
import type { MarketHours } from '../market-hours'

import type { IntradaySnapshotQuery } from '../market-data'
import { utcInstantFromEpochMillis } from '../time'
import type { JevProtocol } from './protocol'

export const makeJevEntryQuery = (input: {
  readonly protocol: JevProtocol
  readonly calendar: MarketHours
  readonly sessionDate: IntradaySnapshotQuery['sessionDate']
  readonly observedAtMs: number
  readonly candidates: readonly string[]
}): IntradaySnapshotQuery => {
  const { protocol, candidates } = input
  const market = jevMarketForSymbol(candidates[0] ?? 'SPY')
  const rangeEndMs = Math.floor((input.observedAtMs - protocol.decisionDelaySeconds * 1000) / 60_000) * 60_000
  return {
    sessionDate: input.sessionDate,
    calendar: input.calendar,
    observedAt: utcInstantFromEpochMillis(input.observedAtMs),
    rangeStartAt: utcInstantFromEpochMillis(rangeEndMs - protocol.lookbackMinutes * 60_000),
    rangeEndAt: utcInstantFromEpochMillis(rangeEndMs),
    universeId: market.universeId,
    universeSymbolHash: market.universeSymbolHash,
    universe: market.universe,
    symbols: [...new Set([...candidates, ...candidates.map(jevBenchmarkSymbol)])].sort(),
    candidateSymbols: candidates,
    ...(protocol.candidateEvidencePolicy === undefined
      ? {}
      : { candidateEvidencePolicy: protocol.candidateEvidencePolicy }),
    feed: market.feed,
    delayClass: market.delayClass,
    sourceTopics: market.sourceTopics,
    maximumQuoteAgeMs: protocol.maximumQuoteAgeMs,
    minimumWatermarkLagMs: protocol.decisionDelaySeconds * 1000,
  }
}

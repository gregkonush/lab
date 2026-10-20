import type { EvaluationBounds, FinalizedSnapshotProvenance } from '../contracts'

import type { DailyBar, InputManifest, IsoDate } from '../types'
import type { SignalSessionRow } from './rows'

export interface SnapshotRequest {
  readonly snapshotId: string
  readonly publicationAsOf: string
  readonly calendarVersion: string
  readonly universe: readonly string[]
  readonly bounds: EvaluationBounds
  readonly observedAt: string
  readonly universeId: FinalizedSnapshotProvenance['universeId']
  readonly universeSymbolHash: string
  readonly historyStart: IsoDate
  readonly evaluationStart: IsoDate
}

export interface MarketDataSnapshot {
  readonly bars: readonly DailyBar[]
  readonly manifest: InputManifest
}

export type VerifiedSignalSession = Pick<
  SignalSessionRow,
  'calendar_version' | 'session_date' | 'close_time' | 'timezone'
>

export interface MarketDataInspection {
  readonly manifest: InputManifest
  readonly sessionDates: readonly IsoDate[]
  readonly signalSession: VerifiedSignalSession
}

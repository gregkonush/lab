import { continuousExecutionPolicy } from '../market-hours'
import type { AutonomousCycle } from './model'

export const unusedEntryExpiresAt = (cycle: Pick<AutonomousCycle, 'createdAt' | 'window'>): number =>
  Math.min(
    Date.parse(cycle.window.submissionCutoffAt),
    Math.max(Date.parse(cycle.createdAt), Date.parse(cycle.window.submissionOpenAt)) +
      continuousExecutionPolicy.entryValidityMs,
  )

import { expect, test } from 'bun:test'
import { Result } from 'effect'
import fc from 'fast-check'

import { nativeJevFixture } from '../jev/native.test-support'
import { checkProperty } from '../testing/property-test-support'
import { continuousExecutionPolicy } from '../market-hours'
import { CycleState, CycleTerminalReason, type AutonomousCycle } from './model'
import { selectCycleRecovery } from './recovery'

const { draft } = nativeJevFixture()
const openMs = Date.parse(draft.window.submissionOpenAt)
const iso = (ms: number) => new Date(ms).toISOString()
interface GenerationInput {
  readonly createdAfterOpenMs: number
  readonly lateMs: number
  readonly state: CycleState.Pending | CycleState.Active
}
const generation: fc.Arbitrary<GenerationInput> = fc.record({
  createdAfterOpenMs: fc.integer({ min: 0, max: 60 * 60_000 }),
  lateMs: fc.integer({ min: 0, max: 60_000 }),
  state: fc.constantFrom(CycleState.Pending, CycleState.Active),
})
const cycleAndScope = (input: GenerationInput) => {
  const createdAt = iso(openMs + input.createdAfterOpenMs)
  const cycle: AutonomousCycle = {
    ...draft,
    state: input.state,
    stateVersion: input.state === CycleState.Active ? 2 : 1,
    bindings: {},
    createdAt,
    updatedAt: createdAt,
  }
  return {
    cycle,
    scope: {
      cycle,
      accountId: draft.identity.accountId,
      cycleBindingId: draft.identity.qualificationRunId,
      strategyProtocolHash: draft.identity.strategyProtocolHash,
      observedAt: createdAt,
    },
    expiresMs: Date.parse(createdAt) + continuousExecutionPolicy.entryValidityMs,
  }
}

test('property: unused entry recovery expires at the exact lease boundary and repeated retries are deterministic', () => {
  checkProperty(
    'cycle-recovery-unused-entry-expiry',
    fc.property(generation, (input) => {
      const { scope, expiresMs } = cycleAndScope(input)
      expect(scope.cycle.schemaVersion).toBe('bayn.autonomous-cycle.v4')
      const before = Result.getOrThrow(selectCycleRecovery({ ...scope, observedAt: iso(expiresMs - 1) }))
      expect(before.action).toBe(input.state === CycleState.Pending ? 'ACTIVATE' : 'BUILD_DECISION')
      for (const atMs of [expiresMs, expiresMs + input.lateMs]) {
        const request = { ...scope, observedAt: iso(atMs) }
        const result = Result.getOrThrow(selectCycleRecovery(request))
        expect(result).toMatchObject({ action: 'BLOCK', reason: CycleTerminalReason.UnusedEntryExpired })
        expect(Result.getOrThrow(selectCycleRecovery(JSON.parse(JSON.stringify(request))))).toEqual(result)
      }
    }),
  )
})

test('property: a bound decision is read after a crash and cannot become a second decision build', () => {
  checkProperty(
    'cycle-recovery-bound-decision',
    fc.property(generation, (input) => {
      const { cycle, scope, expiresMs } = cycleAndScope(input)
      const bound = {
        ...cycle,
        state: CycleState.Active,
        stateVersion: 2,
        bindings: { snapshotId: 'c'.repeat(64), decisionHash: 'd'.repeat(64) },
      }
      const saved = JSON.stringify(bound)
      const request = { ...scope, cycle: bound, observedAt: iso(expiresMs + input.lateMs) }
      expect(Result.getOrThrow(selectCycleRecovery(request))).toEqual({ action: 'READ_DECISION', cycle: bound })
      expect(JSON.stringify(bound)).toBe(saved)
      for (const mismatch of [
        { accountId: `${scope.accountId}-different` },
        { cycleBindingId: 'f'.repeat(64) },
        { observedAt: iso(Date.parse(bound.updatedAt) - 1) },
      ])
        expect(Result.isFailure(selectCycleRecovery({ ...request, ...mismatch }))).toBe(true)
      const terminal = {
        ...bound,
        state: CycleState.NoTrade,
        stateVersion: 3,
        updatedAt: request.observedAt,
        terminalAt: request.observedAt,
      }
      expect(Result.isFailure(selectCycleRecovery({ ...request, cycle: terminal }))).toBe(true)
    }),
  )
})

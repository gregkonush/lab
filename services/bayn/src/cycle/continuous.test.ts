import { nextIntradayEntryAttemptOrdinal } from './runner/calendar-decisions'
import { CycleState } from './model'
import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { continuousMarketHours, tradingWindow, continuousExecutionPolicy } from '../market-hours'
import { decodeJevProtocol, defaultJevProtocolDocument } from '../jev/protocol'
import { makeIntradayCycleDraft } from './runner/calendar-decisions'
import { makeCycleExecutionPolicyFromModel } from './construction'
import { makeInitialCycle } from './store/decisions'
import { bindCycleExecutionSession } from '../execution-session'
import { jevObservationQuery } from '../jev/runtime'

for (const at of ['2026-10-09T23:59:50.000Z', '2026-10-11T00:00:10.000Z']) {
  test(`the current execution lease and signal window survive midnight and weekends at ${at}`, () => {
    const protocol = Result.getOrThrow(decodeJevProtocol(defaultJevProtocolDocument))
    const policy = Result.getOrThrow(makeCycleExecutionPolicyFromModel(protocol.executionModel))
    if (policy.schemaVersion !== 'bayn.autonomous-cycle-execution-policy.v3') throw new Error('Expected current policy')
    const lease = Result.getOrThrow(
      tradingWindow(continuousMarketHours, at, { ...continuousExecutionPolicy, sessionEntryCutoffMs: 0 }),
    )
    if (lease === null) throw new Error('Continuous market must have a finite lease')
    const draft = Result.getOrThrow(
      makeIntradayCycleDraft(
        {
          cycleBindingId: 'a'.repeat(64),
          strategyName: 'jev',
          strategyProtocolHash: 'b'.repeat(64),
          accountId: 'paper-continuous',
          executionPolicy: policy,
        },
        continuousMarketHours,
        lease,
      ),
    )
    const cycle = makeInitialCycle(draft, at)
    const observedAt = new Date(Date.parse(at) + 20_000).toISOString()
    const binding = Result.getOrThrow(
      bindCycleExecutionSession({
        cycle,
        executionSessionDate: cycle.identity.executionSessionDate,
        planningBrokerState: { observedAt, contentHash: 'c'.repeat(64) },
        calendar: continuousMarketHours,
        executionModel: protocol.executionModel,
      }),
    )
    expect(binding.submissionCutoffAt).toBe(new Date(Date.parse(at) + 60_000).toISOString())
    expect(Date.parse(binding.executionSession.closeAt) - Date.parse(at)).toBe(19 * 60_000)
    const query = Result.getOrThrow(jevObservationQuery(cycle, protocol, continuousMarketHours, observedAt))
    expect(query.feed).toBe('us')
    expect(query.candidateSymbols).toEqual(['BTC/USD'])
    expect(Date.parse(query.rangeStartAt)).toBeLessThan(Date.parse(cycle.window.executionOpenAt))
  })
}

test('completed crypto cycles rearm after their old entry deadline and rotate BTC, ETH and SOL', () => {
  const protocol = Result.getOrThrow(decodeJevProtocol(defaultJevProtocolDocument))
  const policy = Result.getOrThrow(makeCycleExecutionPolicyFromModel(protocol.executionModel))
  if (policy.schemaVersion !== 'bayn.autonomous-cycle-execution-policy.v3') throw new Error('Expected current policy')
  let prior: ReturnType<typeof makeInitialCycle> | undefined
  for (const [index, symbol] of ['BTC/USD', 'ETH/USD', 'SOL/USD', 'BTC/USD'].entries()) {
    const at = new Date(Date.parse('2026-10-10T23:40:00.000Z') + index * 20 * 60_000).toISOString()
    const lease = Result.getOrThrow(
      tradingWindow(continuousMarketHours, at, { ...continuousExecutionPolicy, sessionEntryCutoffMs: 0 }),
    )
    if (lease === null) throw new Error('Expected a continuous lease')
    const ordinal = prior === undefined ? 1 : nextIntradayEntryAttemptOrdinal(prior, at, lease.entryCutoffAt)
    expect(ordinal).toBe(index + 1)
    if (ordinal === undefined) throw new Error('Fresh continuous window must rearm')
    const draft = Result.getOrThrow(
      makeIntradayCycleDraft(
        {
          cycleBindingId: 'a'.repeat(64),
          strategyName: 'jev',
          strategyProtocolHash: 'b'.repeat(64),
          accountId: 'paper-continuous',
          executionPolicy: policy,
        },
        continuousMarketHours,
        lease,
        ordinal,
      ),
    )
    const cycle = makeInitialCycle(draft, at)
    const query = Result.getOrThrow(
      jevObservationQuery(cycle, protocol, continuousMarketHours, new Date(Date.parse(at) + 3000).toISOString()),
    )
    expect(query.candidateSymbols).toEqual([symbol])
    if (prior !== undefined) expect(cycle.identity.cycleId).not.toBe(prior.identity.cycleId)
    prior = { ...cycle, state: CycleState.Completed, terminalAt: new Date(Date.parse(at) + 15 * 60_000).toISOString() }
  }
})

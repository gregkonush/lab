import { expect, test } from 'bun:test'
import { Result } from 'effect'
import { assembleEntryTimingReceipts } from './entry-timing'
import type { ResearchCaptureReceipt } from './capture'

const ready: ResearchCaptureReceipt = {
  sequence: 1,
  observedAtMs: Date.parse('2026-10-09T14:00:03.000Z'),
  event: {
    kind: 'entry-readiness',
    batchId: 'a'.repeat(64),
    observationHash: 'b'.repeat(64),
    snapshotHash: 'c'.repeat(64),
    inputAvailableAt: '2026-10-09T14:00:02.000Z',
    deterministicSelectedAt: '2026-10-09T14:00:02.001Z',
    batchCompletedAt: '2026-10-09T14:00:03.000Z',
    deterministicSymbol: 'AAPL',
  },
}
const commit: ResearchCaptureReceipt = {
  sequence: 2,
  observedAtMs: Date.parse('2026-10-09T14:00:03.100Z'),
  event: {
    kind: 'entry-commit',
    batchId: 'a'.repeat(64),
    observationHash: 'b'.repeat(64),
    decisionHash: 'd'.repeat(64),
    decisionCommittedAt: '2026-10-09T14:00:03.100Z',
  },
}

test('timing witnesses require unique ordered native readiness and committed decisions', () => {
  const result = Result.getOrThrow(assembleEntryTimingReceipts('e'.repeat(40), [ready, commit]))
  expect(result.timings).toHaveLength(1)
  expect(result.timings[0]?.decisionCommittedAt).toBe('2026-10-09T14:00:03.100Z')
  expect(result.uncommittedBatchIds).toEqual([])
  expect(Result.getOrThrow(assembleEntryTimingReceipts('e'.repeat(40), [ready])).uncommittedBatchIds).toEqual([
    'a'.repeat(64),
  ])
  for (const events of [[commit], [ready, ready], [ready, commit, commit], [commit, ready]])
    expect(Result.isFailure(assembleEntryTimingReceipts('e'.repeat(40), events))).toBeTrue()
  if (commit.event.kind !== 'entry-commit') throw new Error('Expected commit')
  expect(
    Result.isFailure(
      assembleEntryTimingReceipts('e'.repeat(40), [
        ready,
        { ...commit, event: { ...commit.event, observationHash: 'f'.repeat(64) } },
      ]),
    ),
  ).toBeTrue()
})

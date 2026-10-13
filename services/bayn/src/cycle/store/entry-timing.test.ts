import { expect, test } from 'bun:test'
import { Effect, Result } from 'effect'
import { TestClock } from 'effect/testing'
import { decideJevEntry } from '../../jev/decision'
import { nativeJevDecisionEvidence, nativeJevFixture } from '../../jev/native.test-support'
import { ActiveResearchCapture } from '../../research-capture/observer'
import { CaptureInvalidation, type ResearchCaptureEvent } from '../../research-capture/capture'
import { makeInitialCycle } from './decisions'
import { cycleStoreError } from './model'
import { captureEntryDecisionCommit } from './postgres'

const fixture = nativeJevFixture()
const at = fixture.observation.payload.observedAt
const document = {
  contentHash: 'f'.repeat(64),
  strategyDecision: Result.getOrThrow(decideJevEntry(nativeJevDecisionEvidence(fixture))),
}
const receipt = { changed: true, cycle: makeInitialCycle(fixture.draft, at) }

test('entry timing is sampled only after acknowledgement, never on rollback or idempotent rebind', async () => {
  const events: ResearchCaptureEvent[] = []
  const calls: string[] = []
  await Effect.runPromise(
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse(at))
      const transaction = TestClock.adjust(7).pipe(
        Effect.tap(() => Effect.sync(() => calls.push('committed'))),
        Effect.as(receipt),
      )
      yield* captureEntryDecisionCommit(transaction, document)
      yield* captureEntryDecisionCommit(Effect.succeed({ ...receipt, changed: false }), document)
      yield* captureEntryDecisionCommit(
        Effect.fail(cycleStoreError({ operation: 'bind-decision', failure: 'query', message: 'rollback' })),
        document,
      ).pipe(Effect.result)
    }).pipe(
      Effect.provideService(ActiveResearchCapture, {
        record: (event) => {
          calls.push('captured')
          events.push(event)
        },
        invalidate: () => undefined,
      }),
      Effect.provide(TestClock.layer()),
    ),
  )
  expect(calls).toEqual(['committed', 'captured'])
  expect(events).toEqual([
    {
      kind: 'entry-commit',
      batchId: document.strategyDecision.evidence.batchPlan.batchId,
      observationHash: document.strategyDecision.evidence.batchPlan.observationHash,
      decisionHash: document.contentHash,
      decisionCommittedAt: new Date(Date.parse(at) + 7).toISOString(),
    },
  ])
})

test('a faulty optional capture observer invalidates capture while the acknowledged decision succeeds', async () => {
  const invalidations: CaptureInvalidation[] = []
  const result = await Effect.runPromise(
    captureEntryDecisionCommit(Effect.succeed(receipt), document).pipe(
      Effect.provideService(ActiveResearchCapture, {
        record: () => {
          throw new Error('capture failure')
        },
        invalidate: (reason) => invalidations.push(reason),
      }),
    ),
  )
  expect(result).toBe(receipt)
  expect(invalidations).toEqual([CaptureInvalidation.InvalidEvent])
})

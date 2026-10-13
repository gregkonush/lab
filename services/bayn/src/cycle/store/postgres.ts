import type { ExecutionDecisionDocument } from '../../shadow-decision-contract'
import type { CycleMutationReceipt } from './model'
import { PgClient } from '@effect/sql-pg'
import { Effect, Layer } from 'effect'
import { ActiveResearchCapture, recordResearchCapture } from '../../research-capture/observer'
import { currentUtcInstant } from '../../time'
import type { DatabaseClock } from '../../db/clock'

import { WriterFence, WriterFenceError, type WriterFenceService } from '../../execution/writer-fence'
import { makeCycleBindingPrograms } from './binding-program'
import { makeCycleLifecyclePrograms } from './lifecycle-program'
import { CycleStore, cycleStoreError, type CycleStoreError, type CycleStoreShape } from './model'
import { makeCycleMutationPrimitives } from './mutations'
import { makeCycleQueries } from './queries'
import { makeCycleReadPrograms } from './read-program'

export const makeCycleStore = (clock?: DatabaseClock) =>
  Effect.map(PgClient.PgClient, (sql) => {
    const queries = makeCycleQueries(sql, clock)
    const mutations = makeCycleMutationPrimitives(sql, queries)

    return {
      ...makeCycleReadPrograms(queries),
      ...makeCycleLifecyclePrograms(sql, queries, mutations),
      ...makeCycleBindingPrograms(sql, queries, mutations),
    } satisfies CycleStoreShape
  })

const fenceMutation = <A>(
  operation: CycleStoreError['operation'],
  effect: Effect.Effect<A, CycleStoreError>,
  fence: WriterFenceService,
): Effect.Effect<A, CycleStoreError> =>
  fence.transaction(effect).pipe(
    Effect.mapError((cause) =>
      cause instanceof WriterFenceError
        ? cycleStoreError({
            operation,
            failure: 'query',
            persistenceFailure: 'transaction',
            message: 'autonomous cycle mutation could not acquire the PostgreSQL writer fence',
            cause,
          })
        : cause,
    ),
  )

export const captureEntryDecisionCommit = (
  committed: Effect.Effect<CycleMutationReceipt, CycleStoreError>,
  document: { readonly contentHash: string; readonly strategyDecision?: ExecutionDecisionDocument['strategyDecision'] },
) =>
  committed.pipe(
    Effect.tap((receipt) =>
      Effect.gen(function* () {
        const capture = yield* ActiveResearchCapture
        const decision = document.strategyDecision
        if (capture === undefined || !receipt.changed || decision?.schemaVersion !== 'bayn.jev-entry-target.v1') return
        const decisionCommittedAt = yield* currentUtcInstant
        yield* recordResearchCapture(capture, {
          kind: 'entry-commit',
          batchId: decision.evidence.batchPlan.batchId,
          observationHash: decision.evidence.batchPlan.observationHash,
          decisionHash: document.contentHash,
          decisionCommittedAt,
        })
      }),
    ),
  )

export const withWriterFenceCycleStore = (store: CycleStoreShape, fence: WriterFenceService): CycleStoreShape => ({
  ...store,
  acquire: (...args) => fenceMutation('acquire', store.acquire(...args), fence),
  bindSnapshot: (...args) => fenceMutation('bind-snapshot', store.bindSnapshot(...args), fence),
  activate: (...args) => fenceMutation('activate', store.activate(...args), fence),
  bindDecision: (...args) =>
    captureEntryDecisionCommit(fenceMutation('bind-decision', store.bindDecision(...args), fence), args[1]),
  finish: (...args) => fenceMutation('finish', store.finish(...args), fence),
  block: (...args) => fenceMutation('block', store.block(...args), fence),
})

export const CycleStoreLive = Layer.effect(CycleStore, makeCycleStore())

/** Execution-only interpreter: every durable cycle mutation crosses the same PostgreSQL writer fence as intents. */
export const WriterFencedCycleStoreLive = Layer.effect(
  CycleStore,
  Effect.all({ store: makeCycleStore(), fence: WriterFence }).pipe(
    Effect.map(({ store, fence }) => withWriterFenceCycleStore(store, fence)),
  ),
)

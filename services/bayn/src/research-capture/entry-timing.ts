import { Result, Schema } from 'effect'
import { Sha256Schema, SourceRevisionSchema, SymbolSchema, UtcInstantSchema } from '../schemas'
import type { ResearchCaptureReceipt } from './capture'
import { compareIntradayInstants, intradayInstantNanos, millisecondsAsNanos } from '../market-data/intraday/time'

export const EntryReadinessTimingSchema = Schema.Struct({
  batchId: Sha256Schema,
  observationHash: Sha256Schema,
  snapshotHash: Sha256Schema,
  inputAvailableAt: UtcInstantSchema,
  deterministicSelectedAt: UtcInstantSchema,
  deterministicSymbol: Schema.NullOr(SymbolSchema),
  batchCompletedAt: UtcInstantSchema,
})

export const EntryCommitTimingSchema = Schema.Struct({
  batchId: Sha256Schema,
  observationHash: Sha256Schema,
  decisionHash: Sha256Schema,
  decisionCommittedAt: UtcInstantSchema,
})

export const EntryTimingReceiptSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-entry-timing.v1'),
  sourceRevision: SourceRevisionSchema,
  ...EntryReadinessTimingSchema.fields,
  decisionHash: Sha256Schema,
  decisionCommittedAt: UtcInstantSchema,
})

export const assembleEntryTimingReceipts = (sourceRevision: string, events: readonly ResearchCaptureReceipt[]) =>
  Result.gen(function* () {
    const ready = new Map<string, ResearchCaptureReceipt & { event: typeof EntryReadinessTimingSchema.Type }>()
    const committed = new Set<string>()
    const timings: (typeof EntryTimingReceiptSchema.Type)[] = []
    for (const receipt of events) {
      const event = receipt.event
      if (event.kind === 'entry-readiness') {
        if (
          ready.has(event.batchId) ||
          committed.has(event.batchId) ||
          compareIntradayInstants(event.inputAvailableAt, event.deterministicSelectedAt) > 0 ||
          compareIntradayInstants(event.deterministicSelectedAt, event.batchCompletedAt) > 0 ||
          intradayInstantNanos(event.batchCompletedAt) > millisecondsAsNanos(receipt.observedAtMs)
        )
          return yield* Result.fail('Entry readiness has duplicate identities or reversed native timing')
        ready.set(event.batchId, { ...receipt, event })
      } else if (event.kind === 'entry-commit') {
        const pending = ready.get(event.batchId)
        if (
          pending === undefined ||
          committed.has(event.batchId) ||
          pending.sequence >= receipt.sequence ||
          pending.event.observationHash !== event.observationHash ||
          compareIntradayInstants(pending.event.batchCompletedAt, event.decisionCommittedAt) > 0 ||
          intradayInstantNanos(event.decisionCommittedAt) > millisecondsAsNanos(receipt.observedAtMs)
        )
          return yield* Result.fail('Entry commitment has no unique preceding readiness for the same observation')
        const { kind: _kind, ...readiness } = pending.event
        const timing = yield* Schema.decodeUnknownResult(EntryTimingReceiptSchema)({
          schemaVersion: 'bayn.jev-entry-timing.v1',
          sourceRevision,
          ...readiness,
          decisionHash: event.decisionHash,
          decisionCommittedAt: event.decisionCommittedAt,
        })
        timings.push(timing)
        committed.add(event.batchId)
      }
    }
    return { timings, uncommittedBatchIds: [...ready.keys()].filter((id) => !committed.has(id)) }
  })

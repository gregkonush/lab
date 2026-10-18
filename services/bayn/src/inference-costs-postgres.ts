import { PgClient } from '@effect/sql-pg'
import { Effect, Schema } from 'effect'

import { canonicalHashV1Result } from './hash'
import { InferenceCostError, InferenceCostEvidenceSchema, type InferenceCostEvidence } from './inference-costs'
import type { InferenceExpenseRecord } from './inference-expense'
import { decodeInferenceExpenseSessionRows } from './inference-expense-postgres'
import { IsoDateSchema, StrictNonEmptyStringSchema, UtcInstantSchema } from './schemas'
import type { WriterFenceService } from './execution/writer-fence'
import { forwardPerformanceSnapshot } from './forward-performance/postgres/snapshot'

const maximumRequests = 10_000
const SnapshotSchema = Schema.Array(
  Schema.Struct({ as_of: UtcInstantSchema, requests: Schema.Array(Schema.Unknown), quotes: Schema.Unknown }),
)

/** Session attribution includes every claimed request, even for blocked, unfilled, and no-trade cycles. */
export const readInferenceExpenseSnapshot = (
  sql: PgClient.PgClient,
  accountId: string,
  sessionDate: string,
  writerFence?: WriterFenceService,
): Effect.Effect<
  { readonly evidence: InferenceCostEvidence; readonly quotes: readonly InferenceExpenseRecord[] },
  InferenceCostError
> =>
  Effect.gen(function* () {
    const scope = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ accountId: StrictNonEmptyStringSchema, sessionDate: IsoDateSchema }),
    )({ accountId, sessionDate }).pipe(
      Effect.mapError(() => new InferenceCostError({ message: 'Inference cost account or session is malformed' })),
    )
    const accountBindingHash = yield* Effect.fromResult(
      canonicalHashV1Result({ schemaVersion: 'bayn.inference-cost-account.v1', accountId: scope.accountId }),
    ).pipe(Effect.mapError(() => new InferenceCostError({ message: 'Inference account binding cannot be hashed' })))
    return yield* forwardPerformanceSnapshot(sql, writerFence)
      .withTransaction(
        Effect.gen(function* () {
          // One statement also shares a snapshot inside a READ COMMITTED writer transaction.
          const cuts = yield* sql<Record<string, unknown>>`
            SELECT to_char(transaction_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS as_of,
              COALESCE((SELECT jsonb_agg(item) FROM (
                SELECT request.request_id AS "requestId", request.cycle_id AS "cycleId",
                  request.authority_generation_hash AS "authorityGenerationHash",
                  request.payload AS request, receipt.payload AS receipt, resolution.payload AS resolution
                FROM jev_evaluation_requests AS request
                JOIN autonomous_cycles AS cycle ON cycle.cycle_id = request.cycle_id
                LEFT JOIN jev_evaluation_receipts AS receipt ON receipt.request_id = request.request_id
                LEFT JOIN jev_evaluation_resolutions AS resolution ON resolution.request_id = request.request_id
                WHERE cycle.account_id = ${scope.accountId}
                  AND cycle.execution_session_date = ${scope.sessionDate}::date
                LIMIT ${maximumRequests + 1}
              ) AS item), '[]'::jsonb) AS requests,
              COALESCE((SELECT jsonb_agg(item) FROM (
                SELECT quote_hash AS "quoteHash", payload,
                  to_char(verified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "verifiedAt"
                FROM inference_expense_quotes
                WHERE account_id = ${scope.accountId} AND session_date = ${scope.sessionDate}::date
                ORDER BY quote_hash COLLATE "C" LIMIT ${maximumRequests + 1}
              ) AS item), '[]'::jsonb) AS quotes
          `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(SnapshotSchema)))
          const cut = cuts[0]
          if (cuts.length !== 1 || cut === undefined)
            return yield* new InferenceCostError({ message: 'Inference cost snapshot time is unavailable' })
          const requests = cut.requests
          if (requests.length > maximumRequests)
            return yield* new InferenceCostError({ message: 'Inference cost read exceeded its complete-report limit' })
          const evidence = yield* Schema.decodeUnknownEffect(InferenceCostEvidenceSchema)({
            schemaVersion: 'bayn.inference-cost-evidence.v1',
            accountBindingHash,
            sessionDate: scope.sessionDate,
            asOf: cut.as_of,
            requests,
          })
          const quotes = yield* decodeInferenceExpenseSessionRows(cut.quotes, scope.sessionDate)
          return {
            evidence: {
              ...evidence,
              requests: evidence.requests.toSorted((left, right) => left.requestId.localeCompare(right.requestId)),
            },
            quotes,
          }
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          cause instanceof InferenceCostError
            ? cause
            : new InferenceCostError({ message: 'Inference cost evidence snapshot failed', cause }),
        ),
      )
  })

import { PgClient } from '@effect/sql-pg'
import { Effect, Schema } from 'effect'
import { SignedMicrosSchema } from '../execution/contracts'
import { UtcInstantSchema, strictParseOptions } from '../schemas'
import { ReconciliationStoreError } from './reconciliation'

const OpeningCash = Schema.Tuple([Schema.Struct({ cash_micros: SignedMicrosSchema, observed_at: UtcInstantSchema })])
export const readOpeningCash = (sql: PgClient.PgClient, accountId: string) =>
  Effect.gen(function* () {
    const rows = yield* sql`SELECT snapshot.cash_micros::text AS cash_micros,
    to_char(event.observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
    FROM account_snapshots AS snapshot JOIN broker_events AS event ON event.event_id=snapshot.event_id
    WHERE snapshot.account_id=${accountId} AND event.account_id=${accountId} AND event.event_kind='ACCOUNT'
    ORDER BY event.source_sequence LIMIT 1`
    const [opening] = yield* Schema.decodeUnknownEffect(OpeningCash, strictParseOptions)(rows)
    return opening
  }).pipe(
    Effect.mapError(
      (cause) =>
        new ReconciliationStoreError({
          operation: 'reconcile',
          failure: 'query',
          message: 'Opening cash baseline is unavailable or invalid',
          cause,
        }),
    ),
  )

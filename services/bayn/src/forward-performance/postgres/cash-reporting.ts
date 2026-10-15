import { PgClient } from '@effect/sql-pg'
import { Effect, Schema } from 'effect'
import { cashAccrualReportingOffsetMicros, type StoredAccrual } from '../../db/fee-accruals'
import { UnsignedMicrosSchema } from '../../execution/contracts'
import { Sha256Schema, strictParseOptions } from '../../schemas'
import { postgresError } from './model'

export const readCashReportingOffsets = (
  sql: PgClient.PgClient,
  accountId: string,
  records: readonly (typeof StoredAccrual.Type)[],
  cuts: { readonly baseline: Date; readonly opening: Date; readonly closing: Date },
) =>
  Effect.gen(function* () {
    const rows = yield* sql<Record<string, unknown>>`
      WITH cuts(name,as_of) AS (VALUES
        ('baseline',${cuts.baseline}::timestamptz),
        ('opening',${cuts.opening}::timestamptz),
        ('closing',${cuts.closing}::timestamptz))
      SELECT cuts.name,a.accrual_id,
        (COALESCE((SELECT sum(m.accrual_cash_micros) FROM broker_fee_accrual_matches m
          JOIN broker_fee_accounting f USING(account_id,activity_id)
          WHERE m.accrual_id=a.accrual_id AND f.posted_at<=cuts.as_of AND f.first_observed_at<=cuts.as_of),0)
        -COALESCE((SELECT sum(c.cash_debit_micros) FROM broker_fee_match_corrections c
          WHERE c.accrual_id=a.accrual_id AND c.posted_at<=cuts.as_of
            AND (c.data->'readEvidence'->>'observedAt')::timestamptz<=cuts.as_of),0))::text AS matched_cash_micros
      FROM cuts JOIN broker_fee_accruals a ON a.account_id=${accountId} AND a.kind='CASH'
        AND a.observed_at<=cuts.as_of AND a.posted_at<=cuts.as_of
      ORDER BY cuts.name,a.accrual_id COLLATE "C"
    `.pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.Array(
            Schema.Struct({
              name: Schema.Literals(['baseline', 'opening', 'closing']),
              accrual_id: Sha256Schema,
              matched_cash_micros: UnsignedMicrosSchema,
            }),
          ),
          strictParseOptions,
        ),
      ),
    )
    const byId = new Map(records.map((record) => [record.accrual_id, record]))
    const evidence: Record<keyof typeof cuts, (typeof StoredAccrual.Type)[]> = {
      baseline: [],
      opening: [],
      closing: [],
    }
    for (const row of rows) {
      const record = byId.get(row.accrual_id)
      if (record === undefined || record.data.kind !== 'CASH' || !record.posted)
        return yield* postgresError(new Error('Cash reporting cut lacks its retained posted accrual'))
      evidence[row.name].push({ ...record, matched_cash_micros: row.matched_cash_micros })
    }
    return {
      baseline: cashAccrualReportingOffsetMicros(evidence.baseline),
      opening: cashAccrualReportingOffsetMicros(evidence.opening),
      closing: cashAccrualReportingOffsetMicros(evidence.closing),
    }
  }).pipe(Effect.mapError(postgresError))

import { describe, expect, test } from 'bun:test'
import { NodeServices } from '@effect/platform-node'
import { PgClient } from '@effect/sql-pg'
import { Effect, Layer, ManagedRuntime, Redacted, Result } from 'effect'
import { prepareFeeAccrual } from '../../accounting/fee-accrual'
import { verifyFeeAccrualRecord } from '../../db/fee-accruals'
import { PostgresClientLive } from '../../db/postgres-client'
import { hashLedgerPlanResult } from '../../ledger-plan'
import { baynTestPostgresUrl } from '../../test-environment.test-support'
import { readCashReportingOffsets } from './cash-reporting'

const describePostgres = baynTestPostgresUrl === undefined ? describe.skip : describe
const hash = (char: string) => char.repeat(64)

describePostgres('cash reporting residuals at historical cuts', () => {
  test('uses only settlements and corrections posted by each cut and preserves the native cohort calculation', async () => {
    if (baynTestPostgresUrl === undefined) throw new Error('Missing local PostgreSQL test endpoint')
    const parsed = new URL(baynTestPostgresUrl)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
      throw new Error('Cash reporting integration requires an isolated local _test database')
    const accountId = 'synthetic-reporting-cut'
    const stored = (char: string, projected: string, observed: string, at: string) => {
      const prepared = Result.getOrThrow(
        prepareFeeAccrual(
          {
            schemaVersion: 'bayn.broker-fee-accrual.v2',
            kind: 'CASH',
            accountId,
            symbol: 'USD',
            cycleId: hash(char),
            date: '2026-10-15',
            observedAt: at,
            openingAccountEventId: hash('a'),
            openingCashReportingQuantumMicros: '10000',
            accountEventId: hash(char),
            projectedCashMicros: projected,
            observedCashMicros: observed,
            cashReportingQuantumMicros: '10000',
            sourceTrades: [{ transactionId: hash(char), quantityAtoms: '33000000', priceAtoms: '2500000000000' }],
          },
          7001,
        ),
      )
      return Result.getOrThrow(
        verifyFeeAccrualRecord(
          {
            accrual_id: prepared.accrualId,
            data: prepared.data,
            settlement_date: '2026-10-15',
            content_hash: prepared.contentHash,
            coin_quantity_atoms: null,
            cash_debit_micros: prepared.cashDebitMicros,
            expense_micros: prepared.expenseMicros,
            matched_coin_quantity_atoms: '0',
            matched_cash_micros: prepared.cashDebitMicros ?? '0',
            ledger_plan_hash: Result.getOrThrow(hashLedgerPlanResult(prepared.plan)),
            tigerbeetle_cluster_id: '2001',
            tigerbeetle_ledger: 7001,
            posted: true,
          },
          accountId,
          { clusterId: 2001n, ledger: 7001 },
        ),
      )
    }
    const old = stored('b', '99875376976', '99875170000', '2026-10-15T02:53:00.000Z')
    const recent = stored('c', '99874043104', '99873850000', '2026-10-15T09:51:44.000Z')
    const runtime = ManagedRuntime.make(
      PostgresClientLive(
        {
          operationTimeoutMs: 5000,
          postgres: { url: Redacted.make(baynTestPostgresUrl), tls: false, caPath: '/unused' },
        },
        { maxConnections: 1, applicationName: 'bayn-cash-cut-test' },
      ).pipe(Layer.provideMerge(NodeServices.layer)),
    )
    try {
      const results = await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`CREATE TEMP TABLE broker_fee_accruals(accrual_id text,account_id text,kind text,observed_at timestamptz,posted_at timestamptz) ON COMMIT DROP`
              yield* sql`CREATE TEMP TABLE broker_fee_accrual_matches(accrual_id text,account_id text,activity_id text,accrual_cash_micros numeric) ON COMMIT DROP`
              yield* sql`CREATE TEMP TABLE broker_fee_accounting(account_id text,activity_id text,first_observed_at timestamptz,posted_at timestamptz) ON COMMIT DROP`
              yield* sql`CREATE TEMP TABLE broker_fee_match_corrections(accrual_id text,cash_debit_micros numeric,posted_at timestamptz,data jsonb) ON COMMIT DROP`
              yield* sql`CREATE TEMP TABLE broker_fee_posting_acknowledgements(account_id text,source_kind text,source_id text,acknowledged_at timestamptz) ON COMMIT DROP`
              for (const row of [old, recent])
                yield* sql`INSERT INTO broker_fee_accruals VALUES(${row.accrual_id},${accountId},'CASH',${row.data.observedAt},${row.data.observedAt})`
              yield* sql`INSERT INTO broker_fee_accounting VALUES
                (${accountId},'reg','2026-10-15T07:49:00Z','2026-10-15T07:50:00Z'),
                (${accountId},'crypto-old','2026-10-15T10:29:00Z','2026-10-15T10:30:00Z'),
                (${accountId},'crypto-recent','2026-10-15T10:59:00Z','2026-10-15T11:00:00Z')`
              yield* sql`INSERT INTO broker_fee_accrual_matches VALUES
                (${old.accrual_id},${accountId},'reg',210000),
                (${old.accrual_id},${accountId},'crypto-old',210000),
                (${recent.accrual_id},${accountId},'crypto-recent',190000)`
              yield* sql`INSERT INTO broker_fee_match_corrections VALUES(${old.accrual_id},210000,'2026-10-15T09:51:08Z',
                '{"readEvidence":{"observedAt":"2026-10-15T09:51:01.000Z"}}'::jsonb)`
              yield* sql`INSERT INTO broker_fee_posting_acknowledgements SELECT account_id,'ACCRUAL',accrual_id,posted_at FROM broker_fee_accruals`
              yield* sql`INSERT INTO broker_fee_posting_acknowledgements SELECT account_id,'ACTIVITY',activity_id,posted_at FROM broker_fee_accounting`
              const records = [old, recent]
              const window = yield* readCashReportingOffsets(sql, accountId, records, {
                baseline: new Date('2026-10-15T04:00:00Z'),
                opening: new Date('2026-10-15T04:00:00Z'),
                closing: new Date('2026-10-15T09:51:57Z'),
              })
              const settlement = yield* readCashReportingOffsets(sql, accountId, records, {
                baseline: new Date('2026-10-15T09:51:07Z'),
                opening: new Date('2026-10-15T09:51:09Z'),
                closing: new Date('2026-10-15T11:01:00Z'),
              })
              yield* sql`UPDATE broker_fee_posting_acknowledgements SET acknowledged_at='2026-10-15T10:45:00Z' WHERE source_id='crypto-old'`
              const retried = yield* readCashReportingOffsets(sql, accountId, records, {
                baseline: new Date('2026-10-15T04:00:00Z'),
                opening: new Date('2026-10-15T10:40:00Z'),
                closing: new Date('2026-10-15T11:01:00Z'),
              })
              yield* sql`UPDATE broker_fee_posting_acknowledgements SET acknowledged_at='2026-10-15T10:00:00Z' WHERE source_id=${recent.accrual_id}`
              const lateAccrual = yield* readCashReportingOffsets(sql, accountId, records, {
                baseline: new Date('2026-10-15T04:00:00Z'),
                opening: new Date('2026-10-15T04:00:00Z'),
                closing: new Date('2026-10-15T09:52:00Z'),
              })
              yield* sql`DELETE FROM broker_fee_posting_acknowledgements WHERE source_id='crypto-old'`
              const unknown = yield* readCashReportingOffsets(sql, accountId, records, {
                baseline: new Date('2026-10-15T04:00:00Z'),
                opening: new Date('2026-10-15T04:00:00Z'),
                closing: new Date('2026-10-15T11:01:00Z'),
              })
              return { window, settlement, retried, lateAccrual, unknown }
            }),
          )
        }),
      )
      expect(results.window).toEqual({ baseline: '3024', opening: '3024', closing: '-3104' })
      expect(results.settlement).toEqual({ baseline: '0', opening: '3024', closing: '0' })
      expect(results.retried).toEqual({ baseline: '3024', opening: undefined, closing: '0' })
      expect(results.lateAccrual).toEqual({ baseline: '3024', opening: '3024', closing: undefined })
      expect(results.unknown).toEqual({ baseline: '3024', opening: '3024', closing: undefined })
    } finally {
      await runtime.dispose()
    }
  })
})

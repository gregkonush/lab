import { makeCycleStore } from '../cycle/store/postgres'
import { makeCycleExecutionPolicyFromModel } from '../cycle/construction'
import { makeIntradayCycleDraft } from '../cycle/runner/calendar-decisions'
import { continuousMarketHours, tradingWindow, continuousExecutionPolicy } from '../market-hours'
import { defaultJevProtocolDocument } from '../jev/protocol'
import { NodeServices } from '@effect/platform-node'
import { expect, test } from 'bun:test'
import { PgClient, PgMigrator } from '@effect/sql-pg'
import { Effect, Redacted, Result, Schema } from 'effect'
import { migrationLoader } from './migrations'
import { baynTestPostgresUrl } from '../test-environment.test-support'
import { canonicalHashV1 } from '../hash'
import { prepareAccounting, rebuildAccountingLedger } from '../accounting/domain'
import { planAccountingReceipt } from './execution-store/decisions'
import { AccountingTransactionRowSchema, accountingTransactionFromRow } from './accounting-rows'
import { OrderSide } from '../execution/contracts'

const integration = baynTestPostgresUrl === undefined ? test.skip : test
const url = baynTestPostgresUrl ?? 'postgresql://bayn@127.0.0.1:55493/bayn_test'
const parsed = new URL(url)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || !parsed.pathname.endsWith('_test'))
  throw new Error('Cash-spot integration requires an isolated local _test database')
const client = PgClient.layer({ url: Redacted.make(url), maxConnections: 1 })
const accountId = 'unit-cutover-paper'
const ledger = 7001
const beforeCutover = Effect.gen(function* () {
  const sql = yield* PgClient.PgClient
  yield* sql`DROP SCHEMA public CASCADE`
  yield* sql`CREATE SCHEMA public`
  yield* PgMigrator.run({
    loader: migrationLoader.pipe(Effect.map((rows) => rows.filter(([id]) => id < 97))),
    table: 'schema_migrations',
  })
})
const migrate = PgMigrator.run({ loader: migrationLoader, table: 'schema_migrations' })

const retainFill = (side: OrderSide, previous: { quantityAtoms: string; costMicros: string }, complete = true) =>
  Effect.gen(function* () {
    const sql = yield* PgClient.PgClient
    const at = side === OrderSide.Buy ? '2026-10-11T00:01:03.000Z' : '2026-10-11T00:02:03.000Z'
    const timestamp = at.replace('.000Z', '.000000000Z')
    const fill = {
      schemaVersion: 'bayn.fill.v2' as const,
      accountId,
      fillId: `original-${side}`,
      brokerOrderId: `order-${side}`,
      clientOrderId: `client-${side}`,
      symbol: 'AAPL',
      side,
      quantityAtoms: '1000000000',
      priceAtoms: side === OrderSide.Buy ? '100000000000' : '110000000000',
      feeMicros: '0',
      occurredAt: at,
    }
    const originalFill = {
      schemaVersion: 'bayn.paper-fill.v1',
      accountId,
      fillId: fill.fillId,
      brokerOrderId: fill.brokerOrderId,
      clientOrderId: fill.clientOrderId,
      symbol: fill.symbol,
      side,
      quantityMicros: '1000000',
      priceMicros: (BigInt(fill.priceAtoms) / 1000n).toString(),
      feeMicros: '0',
      occurredAt: at,
    }
    const originalEventHash = canonicalHashV1({
      schemaVersion: 'bayn.paper-fill-source.v1',
      fill: originalFill,
      brokerTransactionTime: timestamp,
    })
    const eventId = canonicalHashV1({
      schemaVersion: 'bayn.paper-broker-event-id.v1',
      broker: 'ALPACA',
      accountId,
      sourceEventId: fill.fillId,
      contentHash: originalEventHash,
    })
    const prepared = Result.getOrThrow(prepareAccounting(eventId, fill, previous, ledger))
    const current = prepared.transaction
    const originalMaterial = {
      schemaVersion: 'bayn.paper-accounting-transaction.v1',
      transactionId: current.transactionId,
      brokerEventId: eventId,
      accountId,
      symbol: current.symbol,
      side,
      quantityMicros: originalFill.quantityMicros,
      priceMicros: originalFill.priceMicros,
      notionalMicros: current.notionalMicros,
      feeMicros: current.feeMicros,
      costBasisMicros: current.costBasisMicros,
      realizedPnlMicros: current.realizedPnlMicros,
      quantityDeltaMicros: (BigInt(current.quantityDeltaAtoms) / 1000n).toString(),
      costBasisDeltaMicros: current.costBasisDeltaMicros,
      cashDeltaMicros: current.cashDeltaMicros,
      ledgerPlanHash: current.ledgerPlanHash,
      occurredAt: at,
    }
    const originalContentHash = canonicalHashV1(originalMaterial)
    yield* sql`INSERT INTO broker_events(event_id,schema_version,content_hash,event_kind,broker,account_id,source_event_id,source_sequence,occurred_at,observed_at)
    VALUES(${eventId},'bayn.paper-broker-event.v1',${originalEventHash},'FILL','ALPACA',${accountId},${fill.fillId},${side === OrderSide.Buy ? 0 : 1},${at},${at})`
    yield* sql`INSERT INTO fills(event_id,account_id,schema_version,fill_id,broker_order_id,client_order_id,symbol,side,quantity_micros,price_micros,fee_micros,source_timestamp)
    VALUES(${eventId},${accountId},'bayn.paper-fill.v1',${fill.fillId},${fill.brokerOrderId},${fill.clientOrderId},'AAPL',${side},'1000000',${originalFill.priceMicros},'0',${timestamp})`
    if (complete) {
      yield* sql`INSERT INTO accounting_transactions(transaction_id,schema_version,broker_event_id,account_id,symbol,side,quantity_micros,price_micros,notional_micros,fee_micros,cost_basis_micros,realized_pnl_micros,quantity_delta_micros,cost_basis_delta_micros,cash_delta_micros,ledger_plan_hash,content_hash,occurred_at)
      VALUES(${current.transactionId},'bayn.paper-accounting-transaction.v1',${eventId},${accountId},'AAPL',${side},'1000000',${originalFill.priceMicros},${current.notionalMicros},'0',${current.costBasisMicros},${current.realizedPnlMicros},${originalMaterial.quantityDeltaMicros},${current.costBasisDeltaMicros},${current.cashDeltaMicros},${current.ledgerPlanHash},${originalContentHash},${at})`
      const receipt = Result.getOrThrow(planAccountingReceipt(prepared, '2001', ledger))
      yield* sql`INSERT INTO accounting_receipts(receipt_id,schema_version,broker_event_id,tigerbeetle_cluster_id,tigerbeetle_ledger,account_ids,transfer_ids,debit_micros,credit_micros,content_hash,recorded_at)
      VALUES(${receipt.receiptId},${receipt.schemaVersion},${eventId},'2001',${ledger},${receipt.accountIds}::numeric[],${receipt.transferIds}::numeric[],${receipt.debitMicros},${receipt.creditMicros},${receipt.contentHash},${at})`
    }
    return {
      prepared,
      originalContentHash,
      eventId,
      originalEventHash,
      normalizedEventHash: canonicalHashV1({
        schemaVersion: 'bayn.fill-source.v2',
        fill,
        brokerTransactionTime: timestamp,
      }),
    }
  })

integration(
  'hard cutover preserves original financial evidence, transfer identities and exact replay across restart',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* beforeCutover
        const buy = yield* sql.withTransaction(retainFill(OrderSide.Buy, { quantityAtoms: '0', costMicros: '0' }))
        const sell = yield* sql.withTransaction(
          retainFill(OrderSide.Sell, { quantityAtoms: '1000000000', costMicros: '100000000' }),
        )
        yield* migrate
        for (const retained of [buy, sell]) {
          const rows = yield* sql<
            Record<string, unknown>
          >`SELECT schema_version,transaction_id,broker_event_id,intent_id,account_id,symbol,side,
        quantity_atoms::text,price_atoms::text,notional_micros::text,fee_micros::text,cost_basis_micros::text,realized_pnl_micros::text,
        quantity_delta_atoms::text,cost_basis_delta_micros::text,cash_delta_micros::text,ledger_plan_hash,content_hash,occurred_at
        FROM accounting_transactions WHERE broker_event_id = ${retained.eventId}`
          const [row] = yield* Schema.decodeUnknownEffect(Schema.Tuple([AccountingTransactionRowSchema]))(rows)
          const transaction = accountingTransactionFromRow(row)
          expect(transaction).toEqual(retained.prepared.transaction)
          expect(Result.getOrThrow(rebuildAccountingLedger(transaction, ledger))).toEqual(retained.prepared.ledger)
          const events = yield* sql<{
            event_id: string
            content_hash: string
            normalized_content_hash: string
          }>`SELECT event_id,content_hash,normalized_content_hash FROM broker_events WHERE event_id = ${retained.eventId}`
          expect(events[0]).toEqual({
            event_id: retained.eventId,
            content_hash: retained.originalEventHash,
            normalized_content_hash: retained.normalizedEventHash,
          })
          const archived = yield* sql<{
            original_hash: string
            valid: boolean
          }>`SELECT original_record->>'content_hash' AS original_hash,
        original_record_hash = encode(sha256(convert_to(original_record::text,'UTF8')),'hex') AS valid
        FROM execution_unit_cutover_archive WHERE table_name = 'accounting_transactions' AND row_id = ${transaction.transactionId}`
          expect(archived[0]).toEqual({ original_hash: retained.originalContentHash, valid: true })
        }
        const receipts = yield* sql<{ count: number }>`SELECT count(*)::int AS count FROM accounting_receipts`
        expect(receipts[0]?.count).toBe(2)
        expect(yield* migrate).toEqual([])
        const mutation = yield* Effect.exit(
          sql`UPDATE execution_unit_cutover_archive SET original_record_hash = repeat('a',64)`,
        )
        expect(mutation._tag).toBe('Failure')
      }).pipe(Effect.provide(client), Effect.provide(NodeServices.layer)),
    )
  },
  15_000,
)

for (const complete of [false, true])
  integration(
    `cutover refuses ${complete ? 'non-flat inventory' : 'an unaccounted fill'} and rolls back the schema`,
    async () => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient
          yield* beforeCutover
          yield* sql.withTransaction(retainFill(OrderSide.Buy, { quantityAtoms: '0', costMicros: '0' }, complete))
          expect((yield* Effect.exit(migrate))._tag).toBe('Failure')
          const columns = yield* sql<{
            count: number
          }>`SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema='public' AND table_name='fills' AND column_name='quantity_micros'`
          expect(columns[0]?.count).toBe(1)
          const applied = yield* sql<{
            count: number
          }>`SELECT count(*)::int AS count FROM schema_migrations WHERE migration_id=97`
          expect(applied[0]?.count).toBe(0)
        }).pipe(Effect.provide(client), Effect.provide(NodeServices.layer)),
      )
    },
    15_000,
  )

integration(
  'current PostgreSQL accepts a crypto lease crossing UTC midnight and replays its exact identity',
  async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* beforeCutover
        yield* migrate
        const store = yield* makeCycleStore()
        const at = '2026-10-10T23:59:50.000Z'
        const lease = Result.getOrThrow(
          tradingWindow(continuousMarketHours, at, { ...continuousExecutionPolicy, sessionEntryCutoffMs: 0 }),
        )
        if (lease === null) throw new Error('Expected a continuous lease')
        const policy = Result.getOrThrow(makeCycleExecutionPolicyFromModel(defaultJevProtocolDocument.executionModel))
        if (policy.schemaVersion !== 'bayn.autonomous-cycle-execution-policy.v3')
          throw new Error('Expected current policy')
        const draft = Result.getOrThrow(
          makeIntradayCycleDraft(
            {
              cycleBindingId: 'a'.repeat(64),
              strategyName: 'jev',
              strategyProtocolHash: 'b'.repeat(64),
              accountId,
              executionPolicy: policy,
            },
            continuousMarketHours,
            lease,
          ),
        )
        const first = yield* store.acquire(draft, at)
        const replay = yield* store.acquire(draft, at)
        expect(first.created).toBe(true)
        expect(replay.created).toBe(false)
        expect(replay.cycle).toEqual(first.cycle)
        expect(first.cycle.window.submissionCutoffAt).toBe('2026-10-11T00:00:50.000Z')
        expect(first.cycle.window.executionCloseAt).toBe('2026-10-11T00:18:50.000Z')
      }).pipe(Effect.provide(client), Effect.provide(NodeServices.layer)),
    )
  },
  15_000,
)

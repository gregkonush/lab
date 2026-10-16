import capitalSizingMigration from '../../migrations/0109_capital_sizing_protocol'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { NodeServices } from '@effect/platform-node'
import { PgClient } from '@effect/sql-pg'
import { Effect, Layer, ManagedRuntime, Redacted, Result } from 'effect'

import availableHistoryMigration from '../../migrations/0108_available_history_protocol'
import { baynTestPostgresUrl } from '../test-environment.test-support'
import { PostgresClientLive } from './postgres-client'
import { postgresMigrations } from './postgres-migrations'

const testUrl = baynTestPostgresUrl ?? 'postgresql://bayn:bayn@127.0.0.1:5432/bayn_test'
const describePostgres = baynTestPostgresUrl === undefined ? describe.skip : describe
const makeRuntime = () =>
  ManagedRuntime.make(
    PostgresClientLive({
      operationTimeoutMs: 10_000,
      postgres: { url: Redacted.make(testUrl), tls: false, caPath: '/unused' },
    }).pipe(Layer.provideMerge(NodeServices.layer)),
  )

describePostgres('available-history database cutover', () => {
  let runtime: ReturnType<typeof makeRuntime>
  beforeAll(() => {
    const url = new URL(testUrl)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test'))
      throw new Error('Migration tests require a local _test database')
    runtime = makeRuntime()
  })
  beforeEach(async () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* sql`DROP SCHEMA public CASCADE`
        yield* sql`CREATE SCHEMA public`
        yield* postgresMigrations
      }),
    ),
  )
  afterAll(async () => runtime.dispose())

  test('installs the current protocol constraint on a fresh database', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const rows = yield* sql`SELECT migration_id FROM schema_migrations WHERE migration_id=108`
        expect(rows).toHaveLength(1)
        const constraints = yield* sql`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid='authority_generations'::regclass AND conname='authority_generations_strategy_contract_check'`
        expect(constraints[0]?.['definition']).toContain('bayn.jev.protocol.v4')
      }),
    )
  })

  test('refuses a held broker position without changing authority or protocol constraints', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* sql`INSERT INTO position_snapshots (snapshot_id,schema_version,account_id,source_hash,
        content_hash,position_count,observed_at)
        VALUES (${'1'.repeat(64)},'bayn.paper-position-snapshot.v1','paper-cutover',${'2'.repeat(64)},
          ${'3'.repeat(64)},1,clock_timestamp())`
        const result = yield* sql.withTransaction(availableHistoryMigration).pipe(Effect.result)
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result))
          expect(result.failure).toMatchObject({
            reason: {
              cause: { code: '55000', message: expect.stringContaining('available-history cutover requires') },
            },
          })
        expect(yield* sql`SELECT position_count FROM position_snapshots`).toEqual([{ position_count: 1 }])
      }),
    )
  })

  test('recognizes a flat fee-net crypto ledger rather than treating the withheld fee as a holding', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`CREATE TEMP TABLE accounting_transactions (
          account_id text, symbol text, quantity_delta_atoms numeric, cost_basis_delta_micros numeric,
          broker_event_id text, transaction_id text) ON COMMIT DROP`
            yield* sql`CREATE TEMP TABLE accounting_receipts (broker_event_id text,receipt_id text) ON COMMIT DROP`
            yield* sql`CREATE TEMP VIEW broker_inventory_debits AS SELECT 'paper-cutover'::text AS account_id,
          'ETH/USD'::text AS symbol, 2500::numeric AS quantity_atoms, 250::numeric AS cost_basis_micros, true AS posted`
            yield* sql`INSERT INTO accounting_transactions VALUES
          ('paper-cutover','ETH/USD',1000000,100000,'buy','buy'),
          ('paper-cutover','ETH/USD',-997500,-99750,'sell','sell')`
            yield* sql`INSERT INTO accounting_receipts VALUES ('buy','buy'),('sell','sell')`
            yield* availableHistoryMigration
            yield* sql`DROP VIEW broker_inventory_debits`
          }),
        )
      }),
    )
  })
})

describePostgres('capital-sizing database cutover', () => {
  let runtime: ReturnType<typeof makeRuntime>
  beforeAll(() => {
    const url = new URL(testUrl)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test'))
      throw new Error('Migration tests require a local _test database')
    runtime = makeRuntime()
  })
  beforeEach(async () =>
    runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* sql`DROP SCHEMA public CASCADE`
        yield* sql`CREATE SCHEMA public`
        yield* postgresMigrations
      }),
    ),
  )
  afterAll(async () => runtime.dispose())

  test('installs the current protocol constraint on a fresh database', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const rows = yield* sql`SELECT migration_id FROM schema_migrations WHERE migration_id=109`
        expect(rows).toHaveLength(1)
        const constraints = yield* sql`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid='authority_generations'::regclass AND conname='authority_generations_strategy_contract_check'`
        expect(constraints[0]?.['definition']).toContain('bayn.jev.protocol.v5')
      }),
    )
  })

  test('refuses a held broker position without changing authority or protocol constraints', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* sql`INSERT INTO position_snapshots (snapshot_id,schema_version,account_id,source_hash,
        content_hash,position_count,observed_at)
        VALUES (${'1'.repeat(64)},'bayn.paper-position-snapshot.v1','paper-cutover',${'2'.repeat(64)},
          ${'3'.repeat(64)},1,clock_timestamp())`
        const result = yield* sql.withTransaction(capitalSizingMigration).pipe(Effect.result)
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isFailure(result))
          expect(result.failure).toMatchObject({
            reason: {
              cause: { code: '55000', message: expect.stringContaining('capital-sizing cutover requires') },
            },
          })
        expect(yield* sql`SELECT position_count FROM position_snapshots`).toEqual([{ position_count: 1 }])
      }),
    )
  })

  test('recognizes a flat fee-net crypto ledger rather than treating the withheld fee as a holding', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`CREATE TEMP TABLE accounting_transactions (
          account_id text, symbol text, quantity_delta_atoms numeric, cost_basis_delta_micros numeric,
          broker_event_id text, transaction_id text) ON COMMIT DROP`
            yield* sql`CREATE TEMP TABLE accounting_receipts (broker_event_id text,receipt_id text) ON COMMIT DROP`
            yield* sql`CREATE TEMP VIEW broker_inventory_debits AS SELECT 'paper-cutover'::text AS account_id,
          'ETH/USD'::text AS symbol, 2500::numeric AS quantity_atoms, 250::numeric AS cost_basis_micros, true AS posted`
            yield* sql`INSERT INTO accounting_transactions VALUES
          ('paper-cutover','ETH/USD',1000000,100000,'buy','buy'),
          ('paper-cutover','ETH/USD',-997500,-99750,'sell','sell')`
            yield* sql`INSERT INTO accounting_receipts VALUES ('buy','buy'),('sell','sell')`
            yield* capitalSizingMigration
            yield* sql`DROP VIEW broker_inventory_debits`
          }),
        )
      }),
    )
  })
})

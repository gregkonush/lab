import setupActionProtocolMigration from '../../migrations/0123_setup_action_protocol'
import completedBarBenchmarksMigration from '../../migrations/0118_completed_bar_benchmarks'
import costSupportedEntryMigration from '../../migrations/0116_cost_supported_entry'
import equityHoursMigration from '../../migrations/0113_extended_equity_hours'
import capitalSizingMigration from '../../migrations/0109_capital_sizing_protocol'
import modelActionMigration from '../../migrations/0111_model_action_protocol'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { NodeServices } from '@effect/platform-node'
import { PgClient, PgMigrator } from '@effect/sql-pg'
import { Effect, Layer, ManagedRuntime, Redacted, Result } from 'effect'

import availableHistoryMigration from '../../migrations/0108_available_history_protocol'
import { baynTestPostgresUrl } from '../test-environment.test-support'
import { migrationLoader } from './migrations'
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

for (const { label, id, protocol, migration } of [
  { label: 'jev-setup-action', id: 123, protocol: 'bayn.jev.protocol.v10', migration: setupActionProtocolMigration },
  { label: 'available-history', id: 108, protocol: 'bayn.jev.protocol.v4', migration: availableHistoryMigration },
  { label: 'capital-sizing', id: 109, protocol: 'bayn.jev.protocol.v5', migration: capitalSizingMigration },
  { label: 'model-action', id: 111, protocol: 'bayn.jev.protocol.v6', migration: modelActionMigration },
  { label: 'equity-hours', id: 113, protocol: 'bayn.jev.protocol.v7', migration: equityHoursMigration },
  { label: 'cost-supported-entry', id: 116, protocol: 'bayn.jev.protocol.v8', migration: costSupportedEntryMigration },
  {
    label: 'completed-bar-benchmark',
    id: 118,
    protocol: 'bayn.jev.protocol.v9',
    migration: completedBarBenchmarksMigration,
  },
]) {
  describePostgres(`${label} database cutover`, () => {
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
          yield* PgMigrator.run({
            loader: migrationLoader.pipe(
              Effect.map((migrations) =>
                migrations.filter(([migrationId]) => migrationId < id || (id === 111 && migrationId === id)),
              ),
            ),
            table: 'schema_migrations',
          })
        }),
      ),
    )
    afterAll(async () => runtime.dispose())

    test('installs its protocol constraint on a fresh database', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient
          yield* PgMigrator.run({
            loader: migrationLoader.pipe(
              Effect.map((migrations) => migrations.filter(([migrationId]) => migrationId <= id)),
            ),
            table: 'schema_migrations',
          })
          const rows = yield* sql`SELECT migration_id FROM schema_migrations WHERE migration_id=${id}`
          expect(rows).toHaveLength(1)
          const constraints = yield* sql`SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conrelid='authority_generations'::regclass AND conname='authority_generations_strategy_contract_check'`
          expect(constraints[0]?.['definition']).toContain(protocol)
        }),
      )
    })

    if (id === 113) {
      test('upgrades an already-recorded equity-hours migration to native limit completion', async () => {
        await runtime.runPromise(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient
            yield* PgMigrator.run({
              loader: migrationLoader.pipe(
                Effect.map((migrations) => migrations.filter(([migrationId]) => migrationId <= id)),
              ),
              table: 'schema_migrations',
            })
            expect(yield* sql`SELECT migration_id FROM schema_migrations WHERE migration_id >= 113`).toEqual([
              { migration_id: 113 },
            ])
            yield* postgresMigrations
            expect(yield* sql`SELECT migration_id FROM schema_migrations WHERE migration_id = 114`).toEqual([
              { migration_id: 114 },
            ])
            const [completion] = yield* sql`SELECT
              to_regprocedure('paper_partial_ioc_entry_is_reconciled_flat(text,text,numeric,timestamptz)') IS NULL AS retired_absent,
              to_regprocedure('paper_partial_limit_entry_is_reconciled_flat(text,text,numeric,timestamptz)') IS NOT NULL AS current_present,
              paper_cycle_completion_evidence_matches(${'f'.repeat(64)}, ${'e'.repeat(64)}, clock_timestamp()) AS unbound_completed`
            expect(completion).toEqual({ retired_absent: true, current_present: true, unbound_completed: false })
          }),
        )
      })
    }

    test('refuses a held broker position without changing authority or protocol constraints', async () => {
      await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient
          yield* sql`INSERT INTO position_snapshots (snapshot_id,schema_version,account_id,source_hash,
        content_hash,position_count,observed_at)
        VALUES (${'1'.repeat(64)},'bayn.paper-position-snapshot.v1','paper-cutover',${'2'.repeat(64)},
          ${'3'.repeat(64)},1,clock_timestamp())`
          const result = yield* sql.withTransaction(migration).pipe(Effect.result)
          expect(Result.isFailure(result)).toBe(true)
          if (Result.isFailure(result))
            expect(result.failure).toMatchObject({
              reason: {
                cause: { code: '55000', message: expect.stringContaining(`${label} cutover requires`) },
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
              yield* migration
              yield* sql`DROP VIEW broker_inventory_debits`
            }),
          )
        }),
      )
    })

    if (id >= 111) {
      test.each([
        { effective: 'PAPER', status: 'DISCREPANCY', reason: null, succeeds: false, changes: false },
        { effective: 'PAPER', status: 'EXACT', reason: null, succeeds: true, changes: true },
        {
          effective: 'OBSERVE',
          status: 'EXACT',
          reason: id === 111 ? 'BLOCKED_CAPITAL_SIZING_CUTOVER' : 'BLOCKED_STRATEGY_PROTOCOL_CUTOVER',
          succeeds: true,
          changes: true,
        },
        ...[
          `reconciliation discrepancy ${'c'.repeat(64)}`,
          'operator hold',
          'unrecognized safety restriction',
          'reconciliation discrepancy malformed',
        ].map((reason) => ({
          effective: 'OBSERVE',
          status: 'DISCREPANCY',
          reason,
          succeeds: id < 116,
          changes: false,
        })),
        ...(id >= 116
          ? [
              {
                effective: 'OBSERVE',
                status: 'DISCREPANCY',
                reason: 'BLOCKED_STRATEGY_PROTOCOL_CUTOVER',
                succeeds: false,
                changes: false,
              },
              { effective: 'OBSERVE', status: 'EXACT', reason: 'operator hold', succeeds: true, changes: false },
            ]
          : []),
      ])(
        'protocol cutover retains non-cutover restrictions: %j',
        async ({ effective, status, reason, succeeds, changes }) => {
          await runtime.runPromise(
            Effect.gen(function* () {
              const sql = yield* PgClient.PgClient
              yield* sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`CREATE TEMP TABLE authority_generations (
                generation_hash text,account_id text,strategy_name text,strategy_parameter_schema_version text,
                CONSTRAINT authority_generations_strategy_parameter_schema_version_check CHECK(true),
                CONSTRAINT authority_generations_strategy_contract_check CHECK(true)) ON COMMIT DROP`
                  yield* sql`CREATE TEMP TABLE authority_state (
                generation_hash text,maximum text,effective text,kill_state text,reason text,version bigint,updated_at timestamptz) ON COMMIT DROP`
                  yield* sql`CREATE TEMP TABLE reconciliations (
                account_id text,status text,reconciled_at timestamptz,reconciliation_id text,
                expected_hash text,observed_hash text,discrepancies jsonb) ON COMMIT DROP`
                  yield* sql`INSERT INTO authority_generations VALUES (${'a'.repeat(64)},'paper-cutover','jev','bayn.jev.protocol.v5')`
                  yield* sql`INSERT INTO authority_state VALUES (${'a'.repeat(64)},'PAPER',${effective},
                ${effective === 'PAPER' ? 'CLEAR' : 'ACTIVE'},${reason},1,clock_timestamp())`
                  yield* sql`INSERT INTO reconciliations (account_id,status,reconciled_at,reconciliation_id)
                VALUES ('paper-cutover',${status},clock_timestamp(),${'b'.repeat(64)})`
                  const result = yield* sql.withTransaction(migration).pipe(Effect.result)
                  if (succeeds) yield* Effect.fromResult(result)
                  expect(Result.isSuccess(result)).toBe(succeeds)
                  const [state] =
                    yield* sql`SELECT maximum,effective,kill_state,reason,version::text AS version FROM authority_state`
                  expect(state).toEqual(
                    changes
                      ? {
                          maximum: 'PAPER',
                          effective: 'OBSERVE',
                          kill_state: 'ACTIVE',
                          reason: 'BLOCKED_STRATEGY_PROTOCOL_CUTOVER',
                          version: '2',
                        }
                      : {
                          maximum: 'PAPER',
                          effective,
                          kill_state: effective === 'PAPER' ? 'CLEAR' : 'ACTIVE',
                          reason,
                          version: '1',
                        },
                  )
                }),
              )
            }),
          )
        },
      )
    }

    if (id === 116 || id === 118) {
      const retiredProtocol = id === 116 ? 'bayn.jev.protocol.v7' : 'bayn.jev.protocol.v8'
      test('retains historical Jev generations but rejects new retired protocol writes', async () => {
        await runtime.runPromise(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient
            yield* sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`CREATE TEMP TABLE authority_generations (
              generation_hash text, account_id text, strategy_name text, strategy_parameter_schema_version text,
              CONSTRAINT authority_generations_strategy_parameter_schema_version_check CHECK(true),
              CONSTRAINT authority_generations_strategy_contract_check CHECK(true)) ON COMMIT DROP`
                yield* sql`INSERT INTO authority_generations VALUES (${'a'.repeat(64)}, 'historical', 'jev', ${retiredProtocol})`
                yield* migration
                expect(yield* sql`SELECT strategy_parameter_schema_version FROM authority_generations`).toEqual([
                  { strategy_parameter_schema_version: retiredProtocol },
                ])
                const rejected = yield* sql
                  .withTransaction(
                    sql`INSERT INTO authority_generations VALUES (${'b'.repeat(64)}, 'current', 'jev', ${retiredProtocol})`,
                  )
                  .pipe(Effect.result)
                expect(Result.isFailure(rejected)).toBe(true)
                yield* sql`INSERT INTO authority_generations VALUES (${'c'.repeat(64)}, 'current', 'jev', ${protocol})`
                expect(yield* sql`SELECT count(*)::int AS count FROM authority_generations`).toEqual([{ count: 2 }])
              }),
            )
          }),
        )
      })
    }
  })
}

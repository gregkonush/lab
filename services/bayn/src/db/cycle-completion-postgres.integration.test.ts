import { expect, test } from 'bun:test'
import { NodeServices } from '@effect/platform-node'
import { PgClient } from '@effect/sql-pg'
import { Effect, Layer, Redacted, Schema } from 'effect'

import originalCompletion from '../../migrations/0064_partial_ioc_completion'
import boundCompletion from '../../migrations/0095_completion_evidence_indexes'
import { baynTestPostgresUrl } from '../test-environment.test-support'
import { PostgresClientLive } from './postgres-client'
import {
  completionCases,
  completionSchemaSql,
  resetCompletionSql,
  malformedCompletionSql,
} from './cycle-completion.test-support'

const postgresTest = baynTestPostgresUrl === undefined ? test.skip : test
const CompletionRows = Schema.Tuple([Schema.Struct({ baseline: Schema.Boolean, candidate: Schema.Boolean })])

postgresTest('bound completion evidence preserves completion results across adversarial fixtures', async () => {
  if (baynTestPostgresUrl === undefined) throw new Error('Missing isolated PostgreSQL fixture')
  const url = new URL(baynTestPostgresUrl)
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test'))
    throw new Error('Completion tests require an isolated local _test database')
  const layer = PostgresClientLive({
    operationTimeoutMs: 30_000,
    postgres: { url: Redacted.make(url.toString()), tls: false, caPath: '/unused' },
  }).pipe(Layer.provideMerge(NodeServices.layer))
  await Effect.runPromise(
    Effect.gen(function* () {
      const sql = yield* PgClient.PgClient
      yield* sql.withTransaction(
        Effect.gen(function* () {
          yield* sql`CREATE SCHEMA completion_binding_test`
          yield* sql`SET LOCAL search_path TO completion_binding_test, public`
          for (const statement of completionSchemaSql.split(';').filter((part) => part.trim().length > 0))
            yield* sql.unsafe(statement)
          // The migrated public helper resolves its unqualified tables against this
          // transaction's isolated search_path, just like the completion functions.
          yield* originalCompletion
          yield* sql`ALTER FUNCTION paper_cycle_completion_evidence_matches(text,text,timestamptz)
            RENAME TO baseline_completion`
          yield* boundCompletion
          for (const fixture of completionCases) {
            for (const statement of `${resetCompletionSql};${fixture.sql}`
              .split(';')
              .filter((part) => part.trim().length > 0))
              yield* sql.unsafe(statement)
            const [row] = yield* sql`SELECT
              baseline_completion('cycle','decision','2026-01-01T00:00:10Z') AS baseline,
              paper_cycle_completion_evidence_matches('cycle','decision','2026-01-01T00:00:10Z') AS candidate
            `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(CompletionRows)))
            expect({ name: fixture.name, ...row }).toEqual({
              name: fixture.name,
              baseline: fixture.expected,
              candidate: fixture.expected,
            })
          }
          for (const statement of resetCompletionSql.split(';').filter((part) => part.trim().length > 0))
            yield* sql.unsafe(statement)
          yield* sql.unsafe(malformedCompletionSql)
          for (const statement of resetCompletionSql.split(';').filter((part) => part.trim().length > 0))
            yield* sql.unsafe(statement)
          // Transaction-local counters measure the installed functions directly, including
          // their nested queries, without depending on argument names or source formatting.
          const scans = sql`SELECT (seq_scan + idx_scan)::integer AS scans
            FROM pg_stat_xact_user_tables
            WHERE relid = 'completion_binding_test.autonomous_cycle_shadow_decisions'::regclass
          `.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ scans: Schema.Number })]))))
          for (const probe of [
            {
              query: sql`SELECT baseline_completion('cycle','decision','2026-01-01T00:00:10Z') AS complete`,
              expected: 2,
            },
            {
              query: sql`SELECT paper_cycle_completion_evidence_matches('cycle','decision','2026-01-01T00:00:10Z') AS complete`,
              expected: 1,
            },
          ]) {
            const [before] = yield* scans
            const [result] = yield* probe.query.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ complete: Schema.Boolean })]))),
            )
            const [after] = yield* scans
            expect(result.complete).toBe(true)
            expect(after.scans - before.scans).toBe(probe.expected)
          }
          yield* sql`DROP SCHEMA completion_binding_test CASCADE`
        }),
      )
    }).pipe(Effect.provide(layer)),
  )
})

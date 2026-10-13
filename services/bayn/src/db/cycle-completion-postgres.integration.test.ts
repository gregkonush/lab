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
const decisionReads = (value: unknown): number => {
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + decisionReads(item), 0)
  if (value === null || typeof value !== 'object') return 0
  return (
    ('Relation Name' in value && value['Relation Name'] === 'autonomous_cycle_shadow_decisions' ? 1 : 0) +
    Object.values(value).reduce<number>((sum, item) => sum + decisionReads(item), 0)
  )
}

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
          // This helper is a production dependency created by the existing migration.
          // Clone its already-migrated definition into the isolated fixture schema.
          const [dependency] = yield* sql`SELECT pg_get_functiondef(
            'public.paper_account_has_unresolved_mutation(text,timestamptz)'::regprocedure
          ) AS definition`.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ definition: Schema.String })]))),
          )
          yield* sql.unsafe(
            dependency.definition.replace(
              'public.paper_account_has_unresolved_mutation',
              'completion_binding_test.paper_account_has_unresolved_mutation',
            ),
          )
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
          // Inspect the actual installed SQL bodies. The old body reads the decision twice;
          // the candidate must bind it once even when the planner already prefers indexes.
          for (const name of ['baseline_completion', 'paper_cycle_completion_evidence_matches']) {
            const [row] = yield* sql`SELECT pg_get_functiondef(
              (${`completion_binding_test.${name}(text,text,timestamptz)`})::regprocedure
            ) AS definition`.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Tuple([Schema.Struct({ definition: Schema.String })]))),
            )
            const body = row.definition.split('AS $function$')[1]?.split('$function$')[0]
            if (body === undefined) throw new Error('Missing installed completion SQL body')
            const probe = body
              .replaceAll('bound_cycle_id', "'cycle'")
              .replaceAll('bound_decision_hash', "'decision'")
              .replaceAll('completion_observed_at', "'2026-01-01T00:00:10Z'::timestamptz")
            const plan = yield* sql.unsafe(`EXPLAIN (FORMAT JSON) ${probe}`)
            expect(decisionReads(plan)).toBe(name === 'baseline_completion' ? 2 : 1)
          }
          yield* sql`DROP SCHEMA completion_binding_test CASCADE`
        }),
      )
    }).pipe(Effect.provide(layer)),
  )
})

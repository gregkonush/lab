import gepaEditorMigration from '../../migrations/0139_jev_gepa_editor'
import structuredEditorMigration from '../../migrations/0138_jev_editor_structured_output'
import jevEditorMigration from '../../migrations/0135_jev_editor_identity'
import jevHarnessMigration from '../../migrations/0132_jev_harness2'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { PgClient } from '@effect/sql-pg'
import { Effect, Layer, ManagedRuntime, Redacted, Result, Schema } from 'effect'
import { NodeHttpClient } from '@effect/platform-node'
import { SqlClient } from 'effect/sql'

import migration from '../../migrations/0093_research_inference'
import harnessMigration from '../../migrations/0129_harness2_research'
import { baynTestPostgresUrl, baynTestTigerBeetleAddress } from '../test-environment.test-support'
import { decodeResearchRun, hashResearch, ResearchOutcome, researchServingIdentity } from './contract'
import { fullTokenBudgetStreamFixture, editorFixture, streamFixture } from './test-support'
import { makeResearchStore, projectResearchExpenses, researchExpensePlan, verifyResearchReceipt } from './store'
import { makeResearchRunner } from './runner'
import { makeTigerBeetleRequestClient } from '../tigerbeetle-client'

const integration = baynTestPostgresUrl === undefined ? describe.skip : describe
integration('research attempt durability with real PostgreSQL', () => {
  const retainedEditor = { ...editorFixture(), schemaVersion: 'bayn.jev-harness2-editor.v3' }
  const retainedId = Result.getOrThrow(hashResearch(retainedEditor))
  let retainedBytes = ''
  let runtime: ManagedRuntime.ManagedRuntime<
    PgClient.PgClient | SqlClient.SqlClient | import('effect/http/HttpClient').HttpClient,
    unknown
  >
  beforeAll(async () => {
    const url = new URL(baynTestPostgresUrl ?? '')
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test'))
      throw new Error('Research persistence tests require an isolated local _test database')
    url.searchParams.set('options', '-c search_path=bayn_research_inference_test')
    runtime = ManagedRuntime.make(
      Layer.mergeAll(
        PgClient.layer({ url: Redacted.make(url.toString()), transformJson: false, maxConnections: 2 }),
        NodeHttpClient.layerNodeHttp,
      ),
    )
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        yield* sql`DROP SCHEMA IF EXISTS bayn_research_inference_test CASCADE`
        yield* sql`CREATE SCHEMA bayn_research_inference_test`
        yield* sql`CREATE FUNCTION reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable fixture'; END; $$`
        yield* migration
        yield* harnessMigration
        yield* jevHarnessMigration
        yield* jevEditorMigration
        yield* structuredEditorMigration
        yield* sql`INSERT INTO research_inference_runs (run_id, payload) VALUES (${retainedId}, ${sql.json(retainedEditor)})`
        const [row] = yield* sql<{
          payload: string
        }>`SELECT payload::text AS payload FROM research_inference_runs WHERE run_id = ${retainedId}`
        if (row === undefined) throw new Error('Missing retained registration')
        retainedBytes = row.payload
        yield* gepaEditorMigration
      }),
    )
  })
  afterAll(async () => {
    if (runtime !== undefined) await runtime.dispose()
  })
  test('hard migration preserves retained bytes and rejects new retired registrations', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const [row] = yield* sql<{
          payload: string
        }>`SELECT payload::text AS payload FROM research_inference_runs WHERE run_id = ${retainedId}`
        expect(row?.payload).toBe(retainedBytes)
        const changed = { ...retainedEditor, attempt: 1 }
        const changedId = Result.getOrThrow(hashResearch(changed))
        expect(
          Result.isFailure(
            yield* sql`INSERT INTO research_inference_runs (run_id, payload) VALUES (${changedId}, ${sql.json(changed)})`.pipe(
              Effect.result,
            ),
          ),
        ).toBe(true)
      }),
    )
  })
  test('rejects a receipt inserted as already expense-verified', async () => {
    await runtime.runPromise(
      Effect.gen(function* () {
        const sql = yield* PgClient.PgClient
        const run = { ...editorFixture(), attempt: 3 }
        const runId = Result.getOrThrow(hashResearch(run))
        yield* makeResearchStore(sql).claim(runId, run)
        const receiptHash = '9'.repeat(64)
        const payload = {
          schemaVersion: 'bayn.research-receipt.v2',
          runId,
          receiptHash,
          qualification: 'UNQUALIFIED',
        }
        const inserted = yield* sql`INSERT INTO research_inference_receipts (run_id, receipt_hash, payload, verified_at)
          VALUES (${runId}, ${receiptHash}, ${sql.json(payload)}, transaction_timestamp())`.pipe(Effect.result)
        expect(Result.isFailure(inserted)).toBe(true)
        expect(yield* makeResearchStore(sql).read(runId)).toBeUndefined()
      }),
    )
  })
  test('claims and replays an instruction proposal through the same immutable store', async () => {
    let calls = 0
    const text = '{"entry":"Assess complete entry plans"}'
    const model = Bun.serve({
      port: 0,
      fetch: () => {
        calls++
        return new Response(streamFixture(text, editorFixture().policy.model), {
          headers: {
            'content-type': 'text/event-stream',
            'x-bayn-serving-identity': JSON.stringify(researchServingIdentity(editorFixture().policy)),
          },
        })
      },
    })
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient
          const store = makeResearchStore(sql)
          const runner = yield* makeResearchRunner(store, `${model.url}v1/chat/completions`, () => ({}), 'b'.repeat(40))
          const now = new Date().toISOString()
          const fixture = editorFixture()
          const run = Result.getOrThrow(
            decodeResearchRun({
              ...fixture,
              registeredAt: now,
              featureCutoff: now,
              deadlineAt: new Date(Date.now() + 30_000).toISOString(),
              costBasis: null,
            }),
          )
          const first = yield* runner.run(run)
          expect(first.outcome).toBe(ResearchOutcome.Complete)
          expect(first.responseText).toBe(text)
          expect(first.instructions).toEqual({ entry: 'Assess complete entry plans' })
          expect(first.workerSourceRevision).toBe('b'.repeat(40))
          expect(run.sourceRevision).toBe('a'.repeat(40))
          const replacedWorker = yield* makeResearchRunner(
            store,
            `${model.url}v1/chat/completions`,
            () => ({}),
            'c'.repeat(40),
          )
          expect(yield* replacedWorker.run(run)).toEqual(first)
          expect(yield* runner.run(run)).toEqual(first)
          expect(calls).toBe(1)
          const forged = { ...run, purpose: 'trade' }
          expect(
            Result.isFailure(
              yield* sql`INSERT INTO research_inference_runs (run_id, payload) VALUES (${'4'.repeat(64)}, ${sql.json(forged)})`.pipe(
                Effect.result,
              ),
            ),
          ).toBe(true)
        }),
      )
    } finally {
      await model.stop(true)
    }
  })
  test('replays a retained receipt without inference and never resends a claimed crash tail', async () => {
    let calls = 0
    const model = Bun.serve({
      port: 0,
      fetch: () => {
        calls++
        return new Response(fullTokenBudgetStreamFixture(editorFixture().policy.model, '{"entry":"Assess"}'), {
          headers: {
            'content-type': 'text/event-stream',
            'x-bayn-serving-identity': JSON.stringify(researchServingIdentity(editorFixture().policy)),
          },
        })
      },
    })
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          const sql = yield* PgClient.PgClient
          const store = makeResearchStore(sql)
          const runner = yield* makeResearchRunner(store, `${model.url}v1/chat/completions`)
          const now = new Date().toISOString()
          const run = {
            ...editorFixture(),
            featureCutoff: now,
            registeredAt: now,
            deadlineAt: new Date(Date.now() + 30_000).toISOString(),
            costBasis: null,
          }
          const first = yield* runner.run(run)
          expect(first.outcome).toBe(ResearchOutcome.Complete)
          expect(first.usage?.completion_tokens).toBe(4096)
          expect(Result.isSuccess(verifyResearchReceipt(run, first))).toBe(true)
          expect(yield* runner.run(run)).toEqual(first)
          expect(calls).toBe(1)
          const crash = { ...run, attempt: 1 }
          expect(yield* store.claim(Result.getOrThrow(hashResearch(crash)), crash)).toBe(true)
          expect((yield* runner.run(crash)).outcome).toBe(ResearchOutcome.Ambiguous)
          expect(calls).toBe(1)
          const changed = { ...first, responseText: 'changed' }
          expect(Result.isFailure(yield* store.finish(run, changed).pipe(Effect.result))).toBe(true)
          expect(
            Result.isFailure(yield* sql`UPDATE research_inference_runs SET payload = payload`.pipe(Effect.result)),
          ).toBe(true)
          expect(Result.isFailure(yield* sql`DELETE FROM research_inference_receipts`.pipe(Effect.result))).toBe(true)
        }),
      )
    } finally {
      await model.stop(true)
    }
  })
  const ledgerTest = baynTestTigerBeetleAddress === undefined ? test.skip : test
  ledgerTest('recovers post-before-ack with exact native ledger transfers and balances', async () => {
    const model = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(streamFixture('{"entry":"Assess"}', editorFixture().policy.model), {
          headers: {
            'content-type': 'text/event-stream',
            'x-bayn-serving-identity': JSON.stringify(researchServingIdentity(editorFixture().policy)),
          },
        }),
    })
    try {
      await runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const sql = yield* PgClient.PgClient
            const store = makeResearchStore(sql)
            const runner = yield* makeResearchRunner(store, `${model.url}v1/chat/completions`)
            const now = new Date().toISOString()
            const run = {
              ...editorFixture(),
              attempt: 2,
              studyHash: crypto.randomUUID().replaceAll('-', '').repeat(2),
              featureCutoff: now,
              registeredAt: now,
              deadlineAt: new Date(Date.now() + 30_000).toISOString(),
              costBasis: {
                ...editorFixture().costBasis,
                sourceEvidenceHash: '4'.repeat(64),
                effectiveFrom: '2026-01-01T00:00:00.000Z',
                effectiveUntil: '2027-01-01T00:00:00.000Z',
                allocation: 'reserved-capacity-wall-time' as const,
                picoUsdPerSecond: '1000000000',
              },
            }
            const receipt = yield* runner.run(run)
            expect(BigInt(receipt.costPicoUsd ?? '0')).toBeGreaterThan(0n)
            const client = yield* makeTigerBeetleRequestClient({
              operationTimeoutMs: 5000,
              tigerBeetle: {
                clusterId: 20912n,
                replicaAddresses: [baynTestTigerBeetleAddress ?? '127.0.0.1:3000'],
                ledger: 7001,
              },
            })
            let acknowledgements = 0
            const losesAcknowledgement = {
              ...store,
              acknowledge: (id: string) =>
                ++acknowledgements === 1 ? sql`SELECT 1 / 0`.pipe(Effect.asVoid) : store.acknowledge(id),
            }
            expect(
              Result.isFailure(yield* projectResearchExpenses(losesAcknowledgement, client).pipe(Effect.result)),
            ).toBe(true)
            yield* projectResearchExpenses(store, client)
            yield* projectResearchExpenses(store, client)
            const plan = yield* Effect.fromResult(researchExpensePlan(run, receipt))
            const accounts = yield* client.request('research-test-account-balances', (active) =>
              active.lookupAccounts(plan.accounts.map((account) => account.id)),
            )
            expect(accounts).toHaveLength(2)
            for (const account of accounts) {
              const debits = plan.transfers.filter((transfer) => transfer.debit_account_id === account.id)
              const credits = plan.transfers.filter((transfer) => transfer.credit_account_id === account.id)
              expect(account.debits_pending).toBe(0n)
              expect(account.credits_pending).toBe(0n)
              expect(account.debits_posted).toBe(debits.reduce((total, transfer) => total + transfer.amount, 0n))
              expect(account.credits_posted).toBe(credits.reduce((total, transfer) => total + transfer.amount, 0n))
            }
            const rows =
              yield* sql`SELECT count(*)::int AS n FROM research_inference_receipts WHERE run_id = ${receipt.runId} AND verified_at IS NOT NULL`.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ n: Schema.Int })))),
              )
            expect(rows[0]?.n).toBe(1)
          }),
        ),
      )
    } finally {
      await model.stop(true)
    }
  })
})

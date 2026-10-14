import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http2'
import { describe, expect, test } from 'bun:test'
import * as restate from '@restatedev/restate-sdk'
import { Clock, Config, Effect, Option, Redacted, Schedule } from 'effect'
import { acquireRestateHttp2Server } from './restate-http2-server'
import { approvePublicInformation, makePublicInformationServices } from './restate-public-information'
import { PublicInformationSource, type PublicInformationRun } from '../public-information'

const admin = Effect.runSync(Config.option(Config.String('BAYN_TEST_RESTATE_ADMIN_URL'))).pipe(Option.getOrUndefined)
const ingress = Effect.runSync(Config.option(Config.String('BAYN_TEST_RESTATE_INGRESS_URL'))).pipe(
  Option.getOrUndefined,
)
const describeRestate = admin === undefined || ingress === undefined ? describe.skip : describe

describeRestate('Real Restate independent public information jobs', () => {
  test('activation and unrelated execution finish while a source is blocked; failure preserves both loops', async () => {
    if (admin === undefined || ingress === undefined) throw new Error('Missing local Restate URLs')
    for (const target of [admin, ingress])
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(target).hostname))
        throw new Error('Local Restate is required')
    const revision = randomUUID().replaceAll('-', '').padEnd(40, 'a')
    const key = Redacted.make('b'.repeat(64))
    const blocked = Promise.withResolvers<PublicInformationRun>()
    let filingsStarted = false
    const result = (source: PublicInformationSource): PublicInformationRun => ({
      schemaVersion: 'bayn.public-information-run.v1',
      source,
      sourceRevision: revision,
      completedAt: '2026-10-14T00:00:00.000Z',
      symbols: [],
      issuerCiks: {},
      artifacts: [],
      missingIssuerSymbols: [],
      unavailableCompanyFacts: [],
      failures: [],
    })
    const services = makePublicInformationServices(
      { sourceRevision: revision, approvalKey: key, intervalMs: () => 60_000 },
      {
        collect: async (source) => {
          if (source === PublicInformationSource.Filings) {
            filingsStarted = true
            return blocked.promise
          }
          return result(source)
        },
      },
    )
    const probe = restate.service({
      name: 'IndependentExecutionProbe',
      handlers: { run: async () => ({ progressed: true }) },
    })
    const request = (path: string, body: unknown) =>
      Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(`${ingress}/${path}`, {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
            signal,
          })
          if (!response.ok) throw new Error(`Local request failed ${response.status}`)
          return response.json()
        },
        catch: (cause) => cause,
      })
    const status = (source: PublicInformationSource) => request('BaynPublicInformationControl/status', source)
    const waitFor = (check: () => Effect.Effect<boolean, unknown>) =>
      Effect.suspend(check).pipe(
        Effect.flatMap((ready) => (ready ? Effect.void : Effect.fail('not ready'))),
        Effect.retry({ schedule: Schedule.spaced('50 millis'), times: 100 }),
      )
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const startedAt = new Date(yield* Clock.currentTimeMillis).toISOString()
          const server = createServer(restate.createEndpointHandler({ services: [...services, probe] }))
          yield* acquireRestateHttp2Server(server, 0)
          const address = server.address()
          if (address === null || typeof address === 'string') throw new Error('Missing local endpoint')
          yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await fetch(`${admin}/deployments`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ uri: `http://host.docker.internal:${address.port}`, force: true }),
                signal,
              })
              if (!response.ok) throw new Error('Registration failed')
            },
            catch: (cause) => cause,
          })
          for (const source of Object.values(PublicInformationSource)) {
            expect(
              yield* request('BaynPublicInformationControl/activate', {
                source,
                sourceRevision: revision,
                approval: approvePublicInformation(source, revision, key),
              }),
            ).toMatchObject({ sequence: 1, lastRun: null })
          }
          yield* waitFor(() => Effect.succeed(filingsStarted))
          expect(yield* request('IndependentExecutionProbe/run', {})).toEqual({ progressed: true })
          yield* waitFor(() =>
            status(PublicInformationSource.Macro).pipe(
              Effect.map(
                (value) => typeof value === 'object' && value !== null && 'lastRun' in value && value.lastRun !== null,
              ),
            ),
          )
          expect(yield* status(PublicInformationSource.Filings)).toMatchObject({ lastRun: null })
          blocked.reject(new Error('injected public upload failure'))
          yield* waitFor(() =>
            status(PublicInformationSource.Filings).pipe(
              Effect.map(
                (value) =>
                  typeof value === 'object' &&
                  value !== null &&
                  'lastFailureAt' in value &&
                  value.lastFailureAt !== null,
              ),
            ),
          )
          expect(yield* status(PublicInformationSource.Filings)).toMatchObject({ sequence: 2, lastRun: null })
          expect(yield* status(PublicInformationSource.Macro)).toMatchObject({ sequence: 2, lastFailureAt: null })
          expect(yield* request('IndependentExecutionProbe/run', {})).toEqual({ progressed: true })
          const privateResponse = yield* Effect.promise(() =>
            fetch(`${ingress}/BaynPublicInformation/SEC_FILINGS/poll`, {
              method: 'POST',
              body: '{}',
              headers: { 'content-type': 'application/json' },
            }),
          )
          expect(privateResponse.status).toBe(400)
          const queued = yield* Effect.tryPromise({
            try: async (signal) => {
              const response = await fetch(`${admin}/query`, {
                method: 'POST',
                headers: { 'content-type': 'application/json', accept: 'application/json' },
                body: JSON.stringify({
                  query: `SELECT COUNT(*) AS queued FROM sys_invocation WHERE target_service_name = 'BaynPublicInformation' AND target_handler_name = 'poll' AND status = 'scheduled' AND created_at >= '${startedAt}'`,
                }),
                signal,
              })
              return response.json()
            },
            catch: (cause) => cause,
          })
          expect(queued).toEqual({ rows: [{ queued: 2 }] })
        }),
      ),
    )
  }, 20_000)
})

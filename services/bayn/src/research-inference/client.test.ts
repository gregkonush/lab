import { describe, expect, test } from 'bun:test'
import { Effect, Result } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { inferResearch, makeResearchStreamDecoder } from './client'
import { hashResearch, ResearchOutcome, researchServingIdentity } from './contract'
import { researchFixture, streamFixture } from './test-support'

const fixture = researchFixture()
const id = Result.getOrThrow(hashResearch(fixture))
const encode = (text: string) => new TextEncoder().encode(text)
describe('bounded native inference stream', () => {
  test('decodes UTF-8 and SSE split at every byte with CRLF boundaries', () => {
    const decoder = makeResearchStreamDecoder(fixture)
    for (const byte of encode(streamFixture().replaceAll('\n', '\r\n')))
      Result.getOrThrow(decoder.push(new Uint8Array([byte]), 10))
    expect(Result.getOrThrow(decoder.complete())).toEqual(['alpha001'])
    expect(decoder.snapshot().usage?.total_tokens).toBe(30)
    expect(decoder.snapshot().firstTokenAtMs).toBe(10)
  })
  test.each([
    streamFixture().replace('data: [DONE]\n\n', ''),
    streamFixture().replace('"total_tokens":30', '"total_tokens":31'),
    streamFixture('<alpha_list>alpha001,alpha001</alpha_list>'),
    streamFixture('<alpha_list>alpha002</alpha_list>'),
    streamFixture().replace('"finish_reason":"stop"', '"finish_reason":"length"'),
    streamFixture().replace('alpha-r1-82c2aa5fcdda', 'wrong-model'),
    streamFixture().replaceAll('"model":"alpha-r1-82c2aa5fcdda",', ''),
    streamFixture()
      .replace('"completion_tokens":20', '"completion_tokens":4097')
      .replace('"total_tokens":30', '"total_tokens":4107'),
    streamFixture('<think><alpha_list>alpha001</alpha_list></think>'),
    streamFixture('<alpha_list>alpha001</alpha_list><alpha_list>alpha001</alpha_list>'),
  ])('rejects malformed or incomplete output %#', (text) => {
    const decoder = makeResearchStreamDecoder(fixture)
    const pushed = decoder.push(encode(text), 10)
    expect(Result.isFailure(pushed) || Result.isFailure(decoder.complete())).toBe(true)
  })
  test('accepts usage at the approved completion-token limit', () => {
    const decoder = makeResearchStreamDecoder({ ...fixture, policy: { ...fixture.policy, max_tokens: 20 } })
    Result.getOrThrow(decoder.push(encode(streamFixture()), 10))
    expect(Result.getOrThrow(decoder.complete())).toEqual(['alpha001'])
  })
  test.each([null, 'model', 'checkpoint', 'servingImage', 'tokenizerRevision', 'chatTemplateRevision'] as const)(
    'rejects missing or mismatched serving attestation: %s',
    async (changed) => {
      const { TestClock } = await import('effect/testing')
      const identity: Record<string, string> = {
        model: fixture.policy.model,
        checkpoint: fixture.policy.checkpoint,
        servingImage: fixture.policy.servingImage,
        tokenizerRevision: fixture.policy.tokenizerRevision,
        chatTemplateRevision: fixture.policy.chatTemplateRevision,
      }
      if (changed !== null)
        identity[changed] =
          changed === 'model' ? 'wrong-model' : changed === 'servingImage' ? `sha256:${'0'.repeat(64)}` : '0'.repeat(40)
      const http = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(streamFixture(), {
              headers: changed === null ? {} : { 'x-bayn-serving-identity': JSON.stringify(identity) },
            }),
          ),
        ),
      )
      const result = await Effect.runPromise(
        inferResearch(fixture, id, 'http://fixture.invalid').pipe(
          Effect.provideService(HttpClient.HttpClient, http),
          Effect.provide(TestClock.layer()),
        ),
      )
      expect(result.outcome).toBe(ResearchOutcome.Rejected)
    },
  )
  test('retains a matching serving attestation independently of JSON key order', async () => {
    const { TestClock } = await import('effect/testing')
    const identity = researchServingIdentity(fixture.policy)
    const header = JSON.stringify(Object.fromEntries(Object.entries(identity).reverse()))
    const http = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(streamFixture(), {
            headers: { 'x-bayn-serving-identity': header },
          }),
        ),
      ),
    )
    const result = await Effect.runPromise(
      inferResearch(fixture, id, 'http://fixture.invalid').pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provide(TestClock.layer()),
      ),
    )
    expect(result.outcome).toBe(ResearchOutcome.Complete)
    expect(result.servingIdentity).toEqual(identity)
  })
  test('bounds retained response memory', () =>
    expect(Result.isFailure(makeResearchStreamDecoder(fixture).push(new Uint8Array(262145), 10))).toBe(true))
  test('never transmits an expired request', async () => {
    let calls = 0
    const http = HttpClient.make((request) => {
      calls++
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(streamFixture())))
    })
    const result = await Effect.runPromise(
      inferResearch(fixture, id, 'http://fixture.invalid').pipe(Effect.provideService(HttpClient.HttpClient, http)),
    )
    expect(result.outcome).toBe(ResearchOutcome.Expired)
    expect(calls).toBe(0)
  })
  test('never transmits before the approved feature cutoff', async () => {
    const { TestClock } = await import('effect/testing')
    let calls = 0
    const http = HttpClient.make((request) => {
      calls++
      return Effect.succeed(HttpClientResponse.fromWeb(request, new Response(streamFixture())))
    })
    const future = { ...fixture, featureCutoff: '1970-01-01T00:00:00.001Z' }
    const result = await Effect.runPromise(
      inferResearch(future, Result.getOrThrow(hashResearch(future)), 'http://fixture.invalid').pipe(
        Effect.provideService(HttpClient.HttpClient, http),
        Effect.provide(TestClock.layer()),
      ),
    )
    expect(result.outcome).toBe(ResearchOutcome.Rejected)
    expect(calls).toBe(0)
  })
})

test.each(['deadline', 'interruption'] as const)(
  'cancels incomplete research streams exactly once on %s',
  async (end) => {
    const { Fiber } = await import('effect')
    const { TestClock } = await import('effect/testing')
    let cancelled = 0
    let reading = false
    const body = new ReadableStream<Uint8Array>({
      pull() {
        reading = true
      },
      cancel() {
        cancelled++
      },
    })
    const http = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(body, {
            headers: {
              'x-bayn-serving-identity': JSON.stringify({
                model: fixture.policy.model,
                checkpoint: fixture.policy.checkpoint,
                servingImage: fixture.policy.servingImage,
                tokenizerRevision: fixture.policy.tokenizerRevision,
                chatTemplateRevision: fixture.policy.chatTemplateRevision,
              }),
            },
          }),
        ),
      ),
    )
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fiber = yield* inferResearch(fixture, id, 'http://fixture.invalid').pipe(
            Effect.provideService(HttpClient.HttpClient, http),
            Effect.forkScoped({ startImmediately: true }),
          )
          yield* Effect.yieldNow
          expect(reading).toBe(true)
          if (end === 'deadline') {
            yield* TestClock.adjust(30_000)
            expect((yield* Fiber.join(fiber)).outcome).toBe(ResearchOutcome.Expired)
          } else yield* Fiber.interrupt(fiber)
          expect(cancelled).toBe(1)
        }),
      ).pipe(Effect.provide(TestClock.layer())),
    )
  },
)

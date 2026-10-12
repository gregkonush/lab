import { describe, expect, test } from 'bun:test'
import { Effect, Result } from 'effect'
import { HttpClient, HttpClientResponse } from 'effect/http'
import { inferResearch, makeResearchStreamDecoder } from './client'
import { hashResearch, ResearchOutcome } from './contract'
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
    streamFixture('<think><alpha_list>alpha001</alpha_list></think>'),
    streamFixture('<alpha_list>alpha001</alpha_list><alpha_list>alpha001</alpha_list>'),
  ])('rejects malformed or incomplete output %#', (text) => {
    const decoder = makeResearchStreamDecoder(fixture)
    const pushed = decoder.push(encode(text), 10)
    expect(Result.isFailure(pushed) || Result.isFailure(decoder.complete())).toBe(true)
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
    const http = HttpClient.make((request) => Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body))))
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

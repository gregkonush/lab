import { Clock, Effect, Result, Schema, Stream } from 'effect'
import { HttpClient, HttpClientRequest } from 'effect/http'

import { canonicalHashV1Result, sha256 } from '../hash'
import {
  parseResearchFactors,
  ResearchError,
  ResearchOutcome,
  researchRequest,
  sealResearchReceipt,
  type ResearchRun,
} from './contract'

const maximumBytes = 262144
const TokenCount = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))
const ChunkSchema = Schema.Struct({
  id: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.String),
  choices: Schema.Array(
    Schema.Struct({
      index: Schema.Int,
      delta: Schema.Struct({
        content: Schema.optionalKey(Schema.NullOr(Schema.String)),
        reasoning_content: Schema.optionalKey(Schema.NullOr(Schema.String)),
      }),
      finish_reason: Schema.NullOr(Schema.String),
    }),
  ),
  usage: Schema.optionalKey(
    Schema.NullOr(
      Schema.Struct({ prompt_tokens: TokenCount, completion_tokens: TokenCount, total_tokens: TokenCount }),
    ),
  ),
})

export const makeResearchStreamDecoder = (run: ResearchRun) => {
  let output = ''
  let pending = ''
  let totalBytes = 0
  const received: Uint8Array[] = []
  let finished = false
  let done = false
  let firstTokenAtMs: number | null = null
  let serverRequestId: string | null = null
  let usage: typeof ChunkSchema.Type.usage = null
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const consume = (frame: string, now: number) =>
    Result.gen(function* () {
      if (frame.trim() === '' || frame.startsWith(':')) return
      const lines = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
      if (lines.length === 0) return
      if (done) return yield* Result.fail(new ResearchError({ message: 'Research stream continued after DONE' }))
      const data = lines.join('\n')
      if (data === '[DONE]') {
        done = true
        return
      }
      const chunk = yield* Schema.decodeUnknownResult(Schema.fromJsonString(ChunkSchema))(data).pipe(
        Result.mapError(() => new ResearchError({ message: 'Research stream contains malformed SSE data' })),
      )
      if (chunk.model !== undefined && chunk.model !== run.policy.model)
        return yield* Result.fail(
          new ResearchError({ message: 'Research response model differs from its frozen policy' }),
        )
      if (chunk.id !== undefined) {
        if (chunk.id.length > 160 || (serverRequestId !== null && serverRequestId !== chunk.id))
          return yield* Result.fail(new ResearchError({ message: 'Research stream request identity changed' }))
        serverRequestId = chunk.id
      }
      if (chunk.usage !== undefined && chunk.usage !== null) {
        if (usage !== null && usage !== undefined)
          return yield* Result.fail(new ResearchError({ message: 'Research stream repeated usage' }))
        if (chunk.usage.total_tokens !== chunk.usage.prompt_tokens + chunk.usage.completion_tokens)
          return yield* Result.fail(new ResearchError({ message: 'Research token usage does not add up' }))
        usage = chunk.usage
      }
      if (chunk.choices.length > 1)
        return yield* Result.fail(new ResearchError({ message: 'Research stream has multiple choices' }))
      for (const choice of chunk.choices) {
        if (choice.index !== 0 || finished)
          return yield* Result.fail(new ResearchError({ message: 'Research stream choice continued after finish' }))
        if (
          choice.delta.reasoning_content !== undefined &&
          choice.delta.reasoning_content !== null &&
          choice.delta.reasoning_content !== ''
        )
          firstTokenAtMs ??= now
        const content = choice.delta.content
        if (content !== undefined && content !== null && content !== '') {
          firstTokenAtMs ??= now
          output += content
        }
        if (choice.finish_reason !== null) {
          if (choice.finish_reason !== 'stop')
            return yield* Result.fail(new ResearchError({ message: 'Research generation did not finish normally' }))
          finished = true
        }
      }
    })
  const push = (bytes: Uint8Array, now: number) =>
    Result.gen(function* () {
      totalBytes += bytes.length
      if (totalBytes > maximumBytes)
        return yield* Result.fail(new ResearchError({ message: 'Research stream exceeds 256 KiB' }))
      received.push(new Uint8Array(bytes))
      pending += yield* Result.try({
        try: () => decoder.decode(bytes, { stream: true }),
        catch: () => new ResearchError({ message: 'Research stream is not UTF-8' }),
      })
      pending = pending.replaceAll('\r\n', '\n')
      let boundary: number
      while ((boundary = pending.indexOf('\n\n')) >= 0) {
        const frame = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        yield* consume(frame, now)
      }
    })
  const snapshot = () => {
    const bytes = Buffer.concat(received)
    return {
      responseText: output,
      responseBase64: bytes.toString('base64'),
      responseHash: bytes.length === 0 ? null : sha256(bytes),
      firstTokenAtMs,
      serverRequestId,
      usage: usage ?? null,
    }
  }
  const complete = () =>
    Result.gen(function* () {
      const tail = yield* Result.try({
        try: () => decoder.decode(),
        catch: () => new ResearchError({ message: 'Research stream ended inside UTF-8' }),
      })
      if (
        tail !== '' ||
        pending.trim() !== '' ||
        !finished ||
        !done ||
        usage === null ||
        usage === undefined ||
        serverRequestId === null
      )
        return yield* Result.fail(
          new ResearchError({ message: 'Research stream lacks complete termination, identity or usage' }),
        )
      return yield* parseResearchFactors(run, output)
    })
  return { push, snapshot, complete }
}

export const inferResearch = Effect.fn('bayn.research.inference')(function* (
  run: ResearchRun,
  runId: string,
  endpoint: string,
  traceHeaders: Readonly<Record<string, string>> = {},
) {
  const startedAtMs = yield* Clock.currentTimeMillis
  const deadline = Date.parse(run.deadlineAt)
  const request = researchRequest(run)
  const requestHash = yield* Effect.fromResult(canonicalHashV1Result(request)).pipe(
    Effect.mapError((cause) => new ResearchError({ message: 'Research request cannot be hashed', cause })),
  )
  const stream = makeResearchStreamDecoder(run)
  let httpStatus: number | null = null
  const state: { outcome: ResearchOutcome } = { outcome: ResearchOutcome.Expired }
  let factors: readonly string[] = []
  if (startedAtMs < deadline) {
    const response = yield* Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient
      const body = JSON.stringify(request)
      if (Buffer.byteLength(body) > maximumBytes)
        return yield* new ResearchError({ message: 'Research request exceeds 256 KiB' })
      const incoming = yield* http.execute(
        HttpClientRequest.post(endpoint).pipe(
          HttpClientRequest.bodyText(body, 'application/json'),
          HttpClientRequest.setHeaders(traceHeaders),
        ),
      )
      httpStatus = incoming.status
      if (httpStatus !== 200) {
        state.outcome = ResearchOutcome.Unavailable
        return
      }
      state.outcome = ResearchOutcome.Rejected
      yield* incoming.stream.pipe(
        Stream.runForEach((bytes) =>
          Effect.gen(function* () {
            yield* Effect.fromResult(stream.push(bytes, yield* Clock.currentTimeMillis))
          }),
        ),
      )
      factors = yield* Effect.fromResult(stream.complete())
      state.outcome = ResearchOutcome.Complete
    }).pipe(Effect.timeout(`${deadline - startedAtMs} millis`), Effect.result)
    if (Result.isFailure(response) && (yield* Clock.currentTimeMillis) >= deadline)
      state.outcome = ResearchOutcome.Expired
    else if (Result.isFailure(response) && httpStatus === null) state.outcome = ResearchOutcome.Ambiguous
  }
  const completedAtMs = yield* Clock.currentTimeMillis
  if (completedAtMs >= deadline && state.outcome === ResearchOutcome.Complete) {
    state.outcome = ResearchOutcome.Expired
    factors = []
  }
  return yield* Effect.fromResult(
    sealResearchReceipt(run, {
      runId,
      requestHash,
      startedAtMs,
      completedAtMs,
      outcome: state.outcome,
      httpStatus,
      ...stream.snapshot(),
      factors,
    }),
  )
}, Effect.scoped)

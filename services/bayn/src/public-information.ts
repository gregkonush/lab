import { createHash } from 'node:crypto'
import { ByteSize, Clock, Context, Data, Effect, Metric, Result, Schema } from 'effect'
import { HttpClient, HttpClientRequest, HttpIncomingMessage } from 'effect/http'

import { canonicalHashV1 } from './hash'
import { GitSourceRevisionSchema, Sha256Schema, SymbolSchema, UtcInstantSchema, strictParseOptions } from './schemas'
import { utcInstantFromEpochMillis } from './time'
import { withObservedSpan } from './telemetry'

export enum PublicInformationSource {
  Filings = 'SEC_FILINGS',
  Macro = 'MACRO_CALENDAR',
}
export const publicInformationIntervalMs = (source: PublicInformationSource) =>
  source === PublicInformationSource.Filings ? 15 * 60_000 : 60 * 60_000
export const PublicArtifactSchema = Schema.Struct({
  url: Schema.String,
  objectKey: Schema.String,
  contentSha256: Sha256Schema,
  byteLength: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 16 * 1024 * 1024 })),
  contentType: Schema.String,
  fetchedAt: UtcInstantSchema,
  storedAt: UtcInstantSchema,
  checkedAt: UtcInstantSchema,
})
export const PublicInformationRunSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.public-information-run.v1'),
  source: Schema.Enum(PublicInformationSource),
  sourceRevision: GitSourceRevisionSchema,
  completedAt: UtcInstantSchema,
  artifacts: Schema.Array(PublicArtifactSchema).check(Schema.isMaxLength(201)),
  missingIssuerSymbols: Schema.Array(SymbolSchema),
  unavailableCompanyFacts: Schema.Array(Schema.Int),
  failures: Schema.Array(
    Schema.Struct({ url: Schema.String, stage: Schema.String, status: Schema.NullOr(Schema.Int) }),
  ),
})
export type PublicArtifact = typeof PublicArtifactSchema.Type
export type PublicInformationRun = typeof PublicInformationRunSchema.Type
export class PublicInformationError extends Data.TaggedError('PublicInformationError')<{
  readonly stage: string
  readonly message: string
  readonly status?: number
}> {}
export class PublicArtifactStore extends Context.Service<
  PublicArtifactStore,
  {
    readonly qualify: (sourceRevision: string) => Effect.Effect<void, PublicInformationError>
    readonly put: (
      key: string,
      body: Uint8Array,
      contentType: string,
      sha256: string,
    ) => Effect.Effect<void, PublicInformationError>
  }
>()('bayn/PublicArtifactStore') {}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const tickerRows = Schema.Record(
  Schema.String,
  Schema.Struct({
    ticker: Schema.String,
    cik_str: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 9_999_999_999 })),
  }),
)
const companyIdentity = Schema.Struct({ cik: Schema.Union([Schema.String, Schema.Int]) })
const polls = Metric.counter('bayn_public_information_polls_total')
const documents = Metric.counter('bayn_public_information_documents_total')
const storedBytes = Metric.counter('bayn_public_information_stored_bytes_total')
export const publicInformationEnabled = Metric.gauge('bayn_public_information_enabled')
export const publicInformationLastSuccess = Metric.gauge('bayn_public_information_last_success_timestamp_seconds')
const duration = Metric.histogram('bayn_public_information_poll_duration_ms', {
  boundaries: [100, 1_000, 5_000, 15_000, 60_000, 120_000, 300_000, 600_000],
})

export const collectPublicInformation = (
  source: PublicInformationSource,
  sourceRevision: string,
  symbols: readonly string[],
  previous: readonly PublicArtifact[],
  pace: Effect.Effect<void> = Effect.sleep('1 second'),
) =>
  Effect.gen(function* () {
    const startedAtMs = yield* Clock.currentTimeMillis
    const http = yield* HttpClient.HttpClient
    const store = yield* PublicArtifactStore
    const retained = new Map(previous.map((artifact) => [artifact.url, artifact]))
    const failures: PublicInformationRun['failures'][number][] = []
    let missingIssuerSymbols: string[] = []
    const unavailableCompanyFacts: number[] = []
    const capture = (url: string, expectedCik?: number) =>
      Effect.gen(function* () {
        const response = yield* http
          .execute(
            HttpClientRequest.get(url, {
              headers: {
                'user-agent': 'ProomptengBaynResearch (+https://proompteng.ai)',
                'accept-encoding': 'identity',
              },
            }),
          )
          .pipe(
            Effect.mapError(
              () => new PublicInformationError({ stage: 'fetch', message: 'Public source transport failed' }),
            ),
          )
        if (response.status !== 200)
          return yield* new PublicInformationError({
            stage: 'fetch',
            status: response.status,
            message: 'Public source returned a non-200 response',
          })
        const body = new Uint8Array(
          yield* response.arrayBuffer.pipe(
            Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.megabytes(16)),
            Effect.mapError(
              () =>
                new PublicInformationError({
                  stage: 'body',
                  message: 'Public source body is unavailable or exceeds 16 MiB',
                }),
            ),
          ),
        )
        if (body.byteLength === 0 || body.byteLength > 16 * 1024 * 1024)
          return yield* new PublicInformationError({ stage: 'body', message: 'Public source body is empty' })
        const text = yield* Effect.try({
          try: () => new TextDecoder('utf-8', { fatal: true }).decode(body),
          catch: () => new PublicInformationError({ stage: 'parse', message: 'Public source is not UTF-8' }),
        })
        if (source === PublicInformationSource.Filings) {
          const identity = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
            Effect.mapError(() => new PublicInformationError({ stage: 'parse', message: 'SEC source is not JSON' })),
          )
          if (expectedCik !== undefined) {
            const company = yield* Schema.decodeUnknownEffect(companyIdentity)(identity).pipe(
              Effect.mapError(
                () => new PublicInformationError({ stage: 'parse', message: 'SEC source lacks its CIK' }),
              ),
            )
            if (String(company.cik).replace(/^0+/, '') !== String(expectedCik))
              return yield* new PublicInformationError({ stage: 'parse', message: 'SEC source CIK differs' })
          }
        } else if (url.endsWith('.ics')) {
          if (!text.startsWith('BEGIN:VCALENDAR') || !text.trimEnd().endsWith('END:VCALENDAR'))
            return yield* new PublicInformationError({ stage: 'parse', message: 'BLS calendar is malformed' })
        } else if (!text.includes('FOMC'))
          return yield* new PublicInformationError({ stage: 'parse', message: 'Federal Reserve calendar is malformed' })
        const fetchedAt = utcInstantFromEpochMillis(yield* Clock.currentTimeMillis)
        const contentSha256 = sha256(body)
        const old = retained.get(url)
        if (old?.contentSha256 === contentSha256) {
          retained.set(url, { ...old, checkedAt: fetchedAt })
          return text
        }
        const objectKey = `captures/v1/public-information/${source}/${fetchedAt.slice(0, 10)}/${canonicalHashV1({ url, fetchedAt, contentSha256 })}`
        const contentType = response.headers['content-type'] ?? 'application/octet-stream'
        yield* store.put(objectKey, body, contentType, contentSha256)
        const storedAt = utcInstantFromEpochMillis(yield* Clock.currentTimeMillis)
        retained.set(url, {
          url,
          objectKey,
          contentSha256,
          byteLength: body.byteLength,
          contentType,
          fetchedAt,
          storedAt,
          checkedAt: fetchedAt,
        })
        yield* Metric.update(documents.pipe(Metric.withAttributes({ source })), 1)
        yield* Metric.update(storedBytes.pipe(Metric.withAttributes({ source })), body.byteLength)
        return text
      }).pipe(
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.timeoutOrElse({
          duration: '30 seconds',
          orElse: () =>
            Effect.fail(
              new PublicInformationError({ stage: 'deadline', message: 'Public source capture exceeded 30 seconds' }),
            ),
        }),
        withObservedSpan('bayn.public-information.capture'),
        Effect.ensuring(pace),
      )
    const attempt = (url: string, expectedCik?: number, allowAbsent = false) =>
      capture(url, expectedCik).pipe(
        Effect.result,
        Effect.tap((result) => {
          if (Result.isSuccess(result)) return Effect.void
          if (allowAbsent && result.failure.status === 404 && expectedCik !== undefined) {
            unavailableCompanyFacts.push(expectedCik)
            return Effect.void
          }
          failures.push({ url, stage: result.failure.stage, status: result.failure.status ?? null })
          return Effect.logWarning('Public information source is incomplete').pipe(
            Effect.annotateLogs({ source, url, stage: result.failure.stage, status: result.failure.status ?? null }),
          )
        }),
      )
    if (source === PublicInformationSource.Filings) {
      const tickers = yield* attempt('https://www.sec.gov/files/company_tickers.json')
      if (Result.isSuccess(tickers)) {
        const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(tickerRows))(tickers.success).pipe(
          Effect.result,
        )
        if (Result.isFailure(decoded))
          failures.push({
            url: 'https://www.sec.gov/files/company_tickers.json',
            stage: 'ticker-mapping',
            status: null,
          })
        else {
          const universe = new Set(symbols)
          const ciks = new Map<string, number>()
          for (const row of Object.values(decoded.success))
            if (universe.has(row.ticker)) {
              if (ciks.has(row.ticker))
                return yield* new PublicInformationError({
                  stage: 'ticker-mapping',
                  message: 'SEC universe contains duplicate tickers',
                })
              ciks.set(row.ticker, row.cik_str)
            }
          missingIssuerSymbols = symbols.filter((symbol) => !ciks.has(symbol)).sort()
          for (const cik of new Set(ciks.values())) {
            const identity = String(cik).padStart(10, '0')
            yield* attempt(`https://data.sec.gov/submissions/CIK${identity}.json`, cik)
            const submission = retained.get(`https://data.sec.gov/submissions/CIK${identity}.json`)
            // Investment funds have submissions but often no XBRL company-facts endpoint. A 404 remains explicit.
            if (submission !== undefined)
              yield* attempt(`https://data.sec.gov/api/xbrl/companyfacts/CIK${identity}.json`, cik, true)
          }
        }
      }
    } else {
      yield* attempt('https://www.bls.gov/schedule/news_release/bls.ics')
      yield* attempt('https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm')
    }
    const completedAt = utcInstantFromEpochMillis(yield* Clock.currentTimeMillis)
    const result: PublicInformationRun = {
      schemaVersion: 'bayn.public-information-run.v1',
      source,
      sourceRevision,
      completedAt,
      artifacts: [...retained.values()].sort((a, b) => a.url.localeCompare(b.url)),
      missingIssuerSymbols,
      unavailableCompanyFacts,
      failures,
    }
    yield* Metric.update(
      polls.pipe(Metric.withAttributes({ source, outcome: failures.length === 0 ? 'complete' : 'incomplete' })),
      1,
    )
    yield* Metric.update(
      duration.pipe(Metric.withAttributes({ source })),
      (yield* Clock.currentTimeMillis) - startedAtMs,
    )
    if (failures.length === 0)
      yield* Metric.update(
        publicInformationLastSuccess.pipe(Metric.withAttributes({ source })),
        Date.parse(completedAt) / 1_000,
      )
    return yield* Schema.decodeUnknownEffect(PublicInformationRunSchema, strictParseOptions)(result)
  }).pipe(
    Effect.withSpan('bayn.public-information.collect', {
      attributes: { 'bayn.public.source': source, 'bayn.source.revision': sourceRevision },
    }),
    Effect.annotateLogs({ source, sourceRevision }),
  )

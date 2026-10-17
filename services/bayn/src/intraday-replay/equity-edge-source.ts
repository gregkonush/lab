import { DateTime, Result, Schema } from 'effect'

import { MarketCalendarResponseSchema } from '../broker/alpaca/model'
import { canonicalHashV1, sha256 } from '../hash'
import { IsoDateSchema, Sha256Schema, SymbolSchema, UtcInstantSchema, strictParseOptions } from '../schemas'
import {
  EquityScreenError,
  indexEquityScreenBars,
  type EquityScreenBar,
  type EquityScreenDay,
} from './equity-edge-screen'

const Period = Schema.Struct({ start: IsoDateSchema, end: IsoDateSchema })
export const EquityEdgeInputSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.equity-edge-screen-input.v1'),
  sourceSha256: Sha256Schema,
  symbols: Schema.Array(SymbolSchema),
  development: Period,
  validation: Period,
  holdout: Period,
})

const Positive = Schema.Finite.check(Schema.isGreaterThan(0))
const Nonnegative = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))
const Bar = Schema.Struct({
  t: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.0{1,9})?Z$/)),
  o: Positive,
  h: Positive,
  l: Positive,
  c: Positive,
  v: Nonnegative,
  vw: Positive,
})
const Header = Schema.Struct({
  kind: Schema.Literal('calendar'),
  observedAt: UtcInstantSchema,
  data: MarketCalendarResponseSchema,
})
const Page = Schema.Struct({
  kind: Schema.Literal('bars'),
  page: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  observedAt: UtcInstantSchema,
  data: Schema.Struct({
    bars: Schema.Record(Schema.String, Schema.Array(Bar)),
    next_page_token: Schema.NullOr(Schema.String),
  }),
})
const End = Schema.Struct({
  kind: Schema.Literal('complete'),
  pages: Schema.Int,
  bars: Schema.Int,
  feed: Schema.Literal('iex'),
  adjustment: Schema.Literal('raw'),
  observedAt: UtcInstantSchema,
})

const instant = (date: string, time: string) => {
  const value = DateTime.makeZoned(
    {
      year: Number(date.slice(0, 4)),
      month: Number(date.slice(5, 7)),
      day: Number(date.slice(8, 10)),
      hour: Number(time.slice(0, 2)),
      minute: Number(time.slice(3, 5)),
      second: 0,
      millisecond: 0,
    },
    { timeZone: 'America/New_York', adjustForTimeZone: true, disambiguation: 'reject' },
  )
  return value._tag === 'None'
    ? Result.fail(new EquityScreenError({ message: 'Invalid regular exchange session instant' }))
    : Result.succeed(Date.parse(DateTime.formatIso(value.value)))
}

/** A byte pin establishes identity, not authenticity, original arrival time, or executable liquidity. */
export const decodeEquityEdgeSource = (text: string, input: typeof EquityEdgeInputSchema.Type) =>
  Result.gen(function* () {
    if (sha256(text) !== input.sourceSha256)
      return yield* Result.fail(new EquityScreenError({ message: 'Historical source SHA-256 mismatch' }))
    const periods = [input.development, input.validation, input.holdout]
    if (
      periods.some((p) => p.start > p.end) ||
      input.development.end >= input.validation.start ||
      input.validation.end >= input.holdout.start
    )
      return yield* Result.fail(new EquityScreenError({ message: 'Temporal partitions must be ordered and disjoint' }))
    if (
      !input.symbols.includes('SPY') ||
      new Set(input.symbols).size !== input.symbols.length ||
      input.symbols.some((s) => s.includes('/'))
    )
      return yield* Result.fail(new EquityScreenError({ message: 'Require unique equity symbols and SPY benchmark' }))
    const lines = text.trimEnd().split('\n')
    const first = lines[0]
    const last = lines.at(-1)
    if (first === undefined || last === undefined || lines.length < 3 || lines.length > 82)
      return yield* Result.fail(new EquityScreenError({ message: 'Source paging envelope is incomplete or excessive' }))
    const header = yield* Schema.decodeUnknownResult(Schema.fromJsonString(Header))(first)
    const end = yield* Schema.decodeUnknownResult(Schema.fromJsonString(End))(last)
    if (end.pages !== lines.length - 2)
      return yield* Result.fail(new EquityScreenError({ message: 'Source page count differs' }))
    const days: EquityScreenDay[] = []
    for (const day of header.data) {
      const openAt = yield* instant(day.date, day.open)
      const closeAt = yield* instant(day.date, day.close)
      const previous = days.at(-1)
      if (openAt >= closeAt || (previous !== undefined && (day.date <= previous.date || openAt <= previous.closeAt)))
        return yield* Result.fail(new EquityScreenError({ message: 'Calendar is not unique and ordered' }))
      days.push({ date: day.date, openAt, closeAt })
    }
    if (periods.some((p) => !days.some((d) => d.date === p.start) || !days.some((d) => d.date === p.end)))
      return yield* Result.fail(
        new EquityScreenError({ message: 'Partition endpoints must be retained trading sessions' }),
      )
    if (days.filter((d) => d.date < input.development.start).length < 14)
      return yield* Result.fail(
        new EquityScreenError({ message: 'Fourteen prior calendar sessions are required for opening-volume context' }),
      )
    const bars: EquityScreenBar[] = []
    const tokens = new Set<string>()
    let lastAcquiredAt = Date.parse(header.observedAt)
    for (let i = 1; i < lines.length - 1; i++) {
      const line = lines[i]
      if (line === undefined) return yield* Result.fail(new EquityScreenError({ message: 'Missing page' }))
      const page = yield* Schema.decodeUnknownResult(Schema.fromJsonString(Page))(line)
      const acquiredAt = Date.parse(page.observedAt)
      if (acquiredAt < lastAcquiredAt || acquiredAt > Date.parse(end.observedAt))
        return yield* Result.fail(new EquityScreenError({ message: 'Source acquisition clock regressed' }))
      lastAcquiredAt = acquiredAt
      const token = page.data.next_page_token
      if (page.page !== i - 1 || (i === lines.length - 2) !== (token === null) || (token !== null && tokens.has(token)))
        return yield* Result.fail(
          new EquityScreenError({ message: 'Source pagination is not complete and progressive' }),
        )
      if (token !== null) tokens.add(token)
      for (const [symbol, rows] of Object.entries(page.data.bars)) {
        if (!input.symbols.includes(symbol))
          return yield* Result.fail(new EquityScreenError({ message: 'Source contains a foreign symbol' }))
        for (const bar of rows) {
          if (Date.parse(bar.t) + 60_000 > acquiredAt)
            return yield* Result.fail(
              new EquityScreenError({ message: 'Historical bar was not complete at acquisition' }),
            )
          bars.push({
            symbol,
            at: Date.parse(bar.t),
            open: bar.o,
            high: bar.h,
            low: bar.l,
            close: bar.c,
            volume: bar.v,
            vwap: bar.vw,
          })
        }
      }
    }
    if (bars.length !== end.bars)
      return yield* Result.fail(new EquityScreenError({ message: 'Source row count differs' }))
    const index = yield* indexEquityScreenBars(bars)
    const coverage = days.map((day) => ({
      date: day.date,
      symbols: input.symbols.map((symbol) => {
        let observed = 0
        const expected = (day.closeAt - day.openAt) / 60_000
        for (let at = day.openAt; at < day.closeAt; at += 60_000) if (index.get(symbol)?.has(at) === true) observed++
        return { symbol, expected, observed, missing: expected - observed }
      }),
    }))
    return {
      index,
      days,
      coverage,
      source: {
        sha256: input.sourceSha256,
        bytes: new TextEncoder().encode(text).length,
        bars: bars.length,
        pages: end.pages,
        feed: end.feed,
        adjustment: end.adjustment,
        calendarHash: canonicalHashV1(days),
        sourceCoverage: 'RECONSTRUCTED_HISTORICAL_BARS',
        originalArrivalTiming: 'UNKNOWN',
        executionCapacity: 'UNKNOWN',
      },
    }
  }).pipe(
    Result.mapError((cause) =>
      cause instanceof EquityScreenError
        ? cause
        : new EquityScreenError({ message: 'Malformed historical market-data source' }),
    ),
  )

export const decodeEquityEdgeInput = Schema.decodeUnknownResult(EquityEdgeInputSchema, strictParseOptions)

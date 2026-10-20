import { NodeRuntime, NodeServices } from '@effect/platform-node'
import { Data, Effect, FileSystem, Schema, Stdio, Stream } from 'effect'

import { sha256 } from '../src/hash'
import { jevEntryEconomics } from '../src/jev/entry-economics'
import { defaultJevProtocolDocument } from '../src/jev/protocol'
import { canonicalHashV1Result } from '../src/hash'
import { UtcSourceTimestampSchema } from '../src/schemas'
import { utcInstantFromEpochMillis } from '../src/time'

class ExitPolicyValidationError extends Data.TaggedError('ExitPolicyValidationError')<{ readonly message: string }> {}

const Positive = Schema.Finite.check(Schema.isGreaterThan(0))
const Bar = Schema.Struct({
  t: UtcSourceTimestampSchema,
  o: Positive,
  h: Positive,
  l: Positive,
  c: Positive,
  v: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  n: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
})
const Page = Schema.Struct({
  page: Schema.Int,
  body: Schema.Struct({
    bars: Schema.Record(Schema.String, Schema.Array(Bar)),
    next_page_token: Schema.NullOr(Schema.String),
  }),
})

const program = (args: readonly string[]) =>
  Effect.gen(function* () {
    const [source, expectedHash] = args
    if (args.length !== 2 || source === undefined || expectedHash === undefined || !/^[a-f0-9]{64}$/.test(expectedHash))
      return yield* new ExitPolicyValidationError({
        message: 'Usage: exit-policy-validation <original-pages.ndjson> <source-sha256>',
      })
    const fs = yield* FileSystem.FileSystem
    const stat = yield* fs.stat(source)
    if (stat.size > 128 * 1024 * 1024)
      return yield* new ExitPolicyValidationError({ message: 'Source exceeds the 128 MiB bound' })
    const text = yield* fs.readFileString(source)
    if (sha256(text) !== expectedHash)
      return yield* new ExitPolicyValidationError({ message: 'Original source SHA-256 mismatch' })
    const pages = yield* Effect.forEach(text.trim().split('\n'), (line) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(Page))(line),
    )
    const last = pages.at(-1)
    if (last === undefined || last.body.next_page_token !== null || pages.some((page, i) => page.page !== i))
      return yield* new ExitPolicyValidationError({ message: 'Original source pagination is incomplete or unordered' })
    const symbols = new Map<string, Map<number, typeof Bar.Type>>()
    for (const page of pages)
      for (const [symbol, bars] of Object.entries(page.body.bars)) {
        let index = symbols.get(symbol)
        if (index === undefined) {
          index = new Map()
          symbols.set(symbol, index)
        }
        for (const bar of bars) {
          const time = Date.parse(bar.t)
          if (time % 60_000 !== 0 || index.has(time))
            return yield* new ExitPolicyValidationError({ message: 'Source contains duplicate or non-minute bars' })
          index.set(time, bar)
        }
      }
    const results = yield* Effect.forEach(
      [...symbols],
      ([symbol, index]) =>
        Effect.gen(function* () {
          const counts: Record<string, number> = {}
          const stops: number[] = []
          const targets: number[] = []
          const record = (key: string) => {
            counts[key] = (counts[key] ?? 0) + 1
          }
          for (const [at, entry] of index) {
            const bars = Array.from({ length: 15 }, (_, i) => {
              const time = at - (15 - i) * 60_000
              const bar = index.get(time)
              return bar === undefined
                ? []
                : [{ symbol, eventAt: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c, final: true }]
            }).flat()
            const previous = index.get(at - 60_000)
            if (previous === undefined || bars.length !== 15) {
              record('MISSING_PRE_ENTRY_EVIDENCE')
              continue
            }
            const result = yield* Effect.fromResult(
              jevEntryEconomics({
                protocol: defaultJevProtocolDocument,
                symbol,
                bars,
                sourceEndAt: utcInstantFromEpochMillis(at),
                bidMicros: BigInt(Math.floor(previous.c * 1_000_000)),
                askMicros: BigInt(Math.ceil(previous.c * 1_000_000)),
                capitalMicros: '100000000000',
              }),
            )
            if (result === null) {
              record('NO_FUNDED_EXIT_PLAN')
              continue
            }
            const plan = result.exitPlan.levels
            const stop = Number(plan.stopPriceMicros) / 1_000_000
            const target = Number(plan.profitLimitPriceMicros) / 1_000_000
            const assumedEntry = entry.o * 1.001
            if (assumedEntry <= stop) {
              record('ENTRY_ALREADY_INVALIDATED')
              continue
            }
            if (assumedEntry * 1_000_000 > Number(plan.maximumEntryPriceMicros)) {
              record('ADVERSE_ENTRY_BEYOND_BOUND')
              continue
            }
            stops.push((1 - stop / assumedEntry) * 10_000)
            targets.push(
              (result.estimatedTargetProfitUsd / (Number(result.exitPlan.acquisitionCostMicros) / 1_000_000)) * 10_000,
            )
            let outcome = 'DEADLINE'
            for (let i = 0; i < 15; i++) {
              const bar = index.get(at + i * 60_000)
              if (bar === undefined) {
                outcome = 'MISSING_HELD_EVIDENCE'
                break
              }
              if (bar.l <= stop && bar.h >= target) {
                outcome = 'AMBIGUOUS_ORDERING'
                break
              }
              if (bar.l <= stop || bar.h >= target) {
                outcome = bar.l <= stop ? 'STOP_TOUCHED_FIRST' : 'TARGET_TOUCHED_FIRST'
                break
              }
            }
            record(outcome)
          }
          const range = (values: number[]) => {
            values.sort((a, b) => a - b)
            return values.length === 0
              ? null
              : { minimum: values[0], median: values[Math.floor(values.length / 2)], maximum: values.at(-1) }
          }
          return {
            symbol,
            sourceBars: index.size,
            counts,
            stopDistanceBps: range(stops),
            estimatedNetTargetBps: range(targets),
          }
        }),
      { concurrency: 1 },
    )
    const stdio = yield* Stdio.Stdio
    yield* Stream.run(
      Stream.make(
        `${JSON.stringify(
          {
            schemaVersion: 'bayn.exit-policy-validation.v1',
            sourceSha256: expectedHash,
            strategyRule: 'completed-horizon-range-continuation',
            parameters: {
              horizonMinutes: defaultJevProtocolDocument.horizonMinutes,
              maximumStopBps: defaultJevProtocolDocument.maximumStopBps,
              maximumCapitalRiskBps: defaultJevProtocolDocument.maximumCapitalRiskBps,
              stopLimitSlippageBps: defaultJevProtocolDocument.maximumEntryLimitSlippageBps,
            },
            protocolHash: yield* Effect.fromResult(canonicalHashV1Result(defaultJevProtocolDocument)),
            hypotheticalCapitalMicros: '100000000000',
            ruleFormulationsInspectedDuringDevelopment: 2,
            actualOrders: false,
            qualified: false,
            limitations: [
              'retrospective bars',
              'no contemporaneous arrivals or executable quotes',
              'touches are not fills',
              'no Jev selection or operating costs',
              'bar closes supply a hypothetical zero-spread planning reference; they are not executable quotes',
              'fixed hypothetical capital is not an observed account balance',
            ],
            results,
          },
          null,
          2,
        )}\n`,
      ),
      stdio.stdout(),
    )
  })

if (import.meta.main)
  NodeRuntime.runMain(
    program(process.argv.slice(2)).pipe(
      // @effect-diagnostics-next-line strictEffectProvide:off -- command owns its files and standard output
      Effect.provide(NodeServices.layer),
    ),
  )

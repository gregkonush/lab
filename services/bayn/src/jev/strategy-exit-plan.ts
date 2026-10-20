import { BigDecimal, Result, Schema } from 'effect'

import { quantizeInstrumentPriceMicros } from '../broker/alpaca-price'
import type { IntradayBar } from '../market-data/intraday/model'
import { PositiveIntegerSchema, SymbolSchema, UtcInstantSchema } from '../schemas'
import { JevContractError } from './contract'

const Price = Schema.String.check(Schema.isPattern(/^[1-9][0-9]*$/))

export const JevStrategyExitPlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-strategy-exit-plan.v1'),
  rule: Schema.Literal('completed-horizon-range-continuation'),
  symbol: SymbolSchema,
  sourceStartAt: UtcInstantSchema,
  sourceEndAt: UtcInstantSchema,
  maximumHoldingMinutes: PositiveIntegerSchema.check(Schema.isLessThanOrEqualTo(60)),
  maximumEntryPriceMicros: Price,
  stopPriceMicros: Price,
  stopLimitPriceMicros: Price,
  profitLimitPriceMicros: Price,
}).check(
  Schema.makeFilter((plan) =>
    BigInt(plan.stopLimitPriceMicros) <= BigInt(plan.stopPriceMicros) &&
    BigInt(plan.stopPriceMicros) < BigInt(plan.maximumEntryPriceMicros) &&
    BigInt(plan.maximumEntryPriceMicros) < BigInt(plan.profitLimitPriceMicros) &&
    Date.parse(plan.sourceEndAt) - Date.parse(plan.sourceStartAt) === plan.maximumHoldingMinutes * 60_000
      ? []
      : [{ path: [], issue: 'exit levels and their complete pre-entry horizon must be ordered' }],
  ),
)
export type JevStrategyExitPlan = typeof JevStrategyExitPlanSchema.Type

export const JevFundedExitPlanSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-funded-exit-plan.v1'),
  levels: JevStrategyExitPlanSchema,
  maximumQuantityAtoms: Price,
  acquisitionCostMicros: Price,
  estimatedStopNetMicros: Price,
  estimatedTargetNetMicros: Price,
  capitalRiskBudgetMicros: Price,
}).check(
  Schema.makeFilter((plan) =>
    BigInt(plan.acquisitionCostMicros) > BigInt(plan.estimatedStopNetMicros) &&
    BigInt(plan.acquisitionCostMicros) - BigInt(plan.estimatedStopNetMicros) <= BigInt(plan.capitalRiskBudgetMicros) &&
    BigInt(plan.estimatedTargetNetMicros) > BigInt(plan.acquisitionCostMicros)
      ? []
      : [{ path: [], issue: 'the funded strategy plan must cover fees and remain within its capital loss budget' }],
  ),
)
export type JevFundedExitPlan = typeof JevFundedExitPlanSchema.Type

export type JevStrategyExitPlanDecision =
  | { readonly _tag: 'Planned'; readonly plan: JevStrategyExitPlan }
  | {
      readonly _tag: 'Excluded'
      readonly reason: 'STOP_RISK' | 'TARGET_BELOW_ENTRY' | 'PRICE_PRECISION' | 'INSUFFICIENT_EXIT_EVIDENCE'
    }

const signalPrice = (value: number, mode: 'floor' | 'ceil') => {
  const rounded = BigDecimal.round(BigDecimal.fromNumberUnsafe(value), { scale: 6, mode })
  return BigDecimal.scale(rounded, 6).value
}

export const deriveJevStrategyExitPlan = (input: {
  readonly symbol: string
  readonly bars: readonly Pick<IntradayBar, 'symbol' | 'eventAt' | 'open' | 'high' | 'low' | 'close' | 'final'>[]
  readonly sourceEndAt: string
  readonly maximumEntryPriceMicros: bigint
  readonly maximumHoldingMinutes: number
  readonly maximumStopBps: number
  readonly stopLimitSlippageBps: number
}): Result.Result<JevStrategyExitPlanDecision, JevContractError> =>
  Result.gen(function* () {
    const end = Date.parse(input.sourceEndAt)
    const count = input.maximumHoldingMinutes
    if (
      !Number.isSafeInteger(end) ||
      end % 60_000 !== 0 ||
      !Number.isSafeInteger(count) ||
      count < 1 ||
      count > 60 ||
      !Number.isSafeInteger(input.maximumStopBps) ||
      input.maximumStopBps < 1 ||
      input.maximumStopBps > 500 ||
      !Number.isSafeInteger(input.stopLimitSlippageBps) ||
      input.stopLimitSlippageBps < 0 ||
      input.stopLimitSlippageBps >= 10_000 ||
      input.maximumEntryPriceMicros <= 0n
    )
      return yield* Result.fail(new JevContractError({ message: 'Invalid strategy exit-plan parameters' }))
    const start = end - count * 60_000
    const bars = input.bars
      .filter((bar) => bar.symbol === input.symbol && Date.parse(bar.eventAt) >= start)
      .toSorted((a, b) => a.eventAt.localeCompare(b.eventAt))
    if (
      bars.some(
        (bar, index) =>
          !bar.final ||
          Date.parse(bar.eventAt) >= end ||
          Date.parse(bar.eventAt) % 60_000 !== 0 ||
          (index > 0 && bars[index - 1]?.eventAt === bar.eventAt) ||
          ![bar.open, bar.high, bar.low, bar.close].every((value) => Number.isFinite(value) && value > 0) ||
          bar.low > Math.min(bar.open, bar.close) ||
          bar.high < Math.max(bar.open, bar.close),
      )
    )
      return yield* Result.fail(
        new JevContractError({ message: 'Strategy exits require valid unique completed pre-entry bars' }),
      )
    if (bars.length !== count || bars.some((bar, index) => Date.parse(bar.eventAt) !== start + index * 60_000))
      return { _tag: 'Excluded', reason: 'INSUFFICIENT_EXIT_EVIDENCE' } as const
    const low = signalPrice(Math.min(...bars.map((bar) => bar.low)), 'floor')
    const high = signalPrice(Math.max(...bars.map((bar) => bar.high)), 'ceil')
    const stop = quantizeInstrumentPriceMicros(input.symbol, low - 1n, 'DOWN')
    const target = quantizeInstrumentPriceMicros(input.symbol, input.maximumEntryPriceMicros + high - low, 'UP')
    if (stop <= 0n || high <= low) return { _tag: 'Excluded', reason: 'PRICE_PRECISION' } as const
    if (stop >= input.maximumEntryPriceMicros || target <= input.maximumEntryPriceMicros)
      return { _tag: 'Excluded', reason: 'TARGET_BELOW_ENTRY' } as const
    if ((input.maximumEntryPriceMicros - stop) * 10_000n > input.maximumEntryPriceMicros * BigInt(input.maximumStopBps))
      return { _tag: 'Excluded', reason: 'STOP_RISK' } as const
    const stopLimit = quantizeInstrumentPriceMicros(
      input.symbol,
      (stop * BigInt(10_000 - input.stopLimitSlippageBps) + 9_999n) / 10_000n,
      'UP',
    )
    if (stopLimit <= 0n || stopLimit > stop) return { _tag: 'Excluded', reason: 'PRICE_PRECISION' } as const
    return {
      _tag: 'Planned',
      plan: {
        schemaVersion: 'bayn.jev-strategy-exit-plan.v1',
        rule: 'completed-horizon-range-continuation',
        symbol: input.symbol,
        sourceStartAt: new Date(start).toISOString(),
        sourceEndAt: input.sourceEndAt,
        maximumHoldingMinutes: count,
        maximumEntryPriceMicros: input.maximumEntryPriceMicros.toString(),
        stopPriceMicros: stop.toString(),
        stopLimitPriceMicros: stopLimit.toString(),
        profitLimitPriceMicros: target.toString(),
      },
    }
  })

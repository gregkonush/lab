import { Result, Schema } from 'effect'

import { quantizeAlpacaLimitPriceMicros } from '../broker/alpaca-price'
import { OrderSide } from '../execution/contracts'
import { notionalMicros } from '../execution-model'
import { quantityScale } from '../quantity'
import { PositiveMicrosSchema } from '../schemas'
import type { IntradayMomentumProtocol } from '../strategy/intraday-momentum/protocol'

export interface IntradayReplayIocAssumptions {
  readonly slippageBps: number
  readonly availableLiquidityPpm: number
}

const BPS = 10_000n
const PPM = 1_000_000n
const U128_MAX = (1n << 128n) - 1n
const isPositiveMicros = Schema.is(PositiveMicrosSchema)
type CoreCancelReason = 'adverse-price-exceeds-limit' | 'no-displayed-liquidity' | 'zero-after-whole-share-rounding'

export interface IntradayReplayIocCoreOrder {
  readonly side: OrderSide
  readonly quantityAtoms: bigint
  readonly limitPriceMicros: bigint
}

/** Executable quote values selected from one event-time market snapshot. */
export interface IntradayReplayIocCoreQuote {
  readonly priceMicros: bigint
  readonly displayedQuantityAtoms: bigint
}

export interface IntradayReplayIocCoreInput {
  readonly order: IntradayReplayIocCoreOrder
  readonly quote: IntradayReplayIocCoreQuote
  readonly executionModel: IntradayMomentumProtocol['executionModel']
  readonly assumptions: IntradayReplayIocAssumptions
}

export type IntradayReplayIocCoreOutcome =
  | {
      readonly status: 'filled'
      readonly requestedQuantityAtoms: bigint
      readonly filledQuantityAtoms: bigint
      readonly fillPriceMicros: bigint
      readonly fillNotionalMicros: bigint
      readonly unfilledRemainder: 'none' | 'canceled'
    }
  | {
      readonly status: 'canceled'
      readonly adversePriceMicros: bigint
      readonly requestedQuantityAtoms: bigint
      readonly filledQuantityAtoms: bigint
      readonly reason: 'adverse-price-exceeds-limit' | 'no-displayed-liquidity' | 'zero-after-whole-share-rounding'
      readonly unfilledRemainder: 'canceled'
    }

export interface IntradayReplayIocCoreFailure {
  readonly _tag: 'InvalidIntradayReplayCoreInput'
  readonly field: string
  readonly value: unknown
  readonly reason:
    | 'invalid-order'
    | 'invalid-quote'
    | 'invalid-assumptions'
    | 'invalid-execution-model'
    | 'invalid-notional'
    | 'insufficient-market-close-liquidity'
}

const invalid = (
  field: string,
  value: unknown,
  reason: IntradayReplayIocCoreFailure['reason'],
): IntradayReplayIocCoreFailure => ({ _tag: 'InvalidIntradayReplayCoreInput', field, value, reason })

const modelQuantityIncrement = (value: string): bigint | undefined => {
  if (!isPositiveMicros(value)) return undefined
  const parsed = BigInt(value)
  return parsed <= U128_MAX ? parsed : undefined
}

const simulateExecution = (
  input: Omit<IntradayReplayIocCoreInput, 'order'> & {
    readonly order: Omit<IntradayReplayIocCoreOrder, 'limitPriceMicros'> & { readonly limitPriceMicros: bigint | null }
  },
): Result.Result<IntradayReplayIocCoreOutcome, IntradayReplayIocCoreFailure> => {
  const { order, quote, assumptions, executionModel: model } = input
  if (
    (order.side !== OrderSide.Buy && order.side !== OrderSide.Sell) ||
    order.quantityAtoms <= 0n ||
    (order.limitPriceMicros === null
      ? order.side !== OrderSide.Sell
      : order.quantityAtoms % quantityScale !== 0n || order.limitPriceMicros <= 0n)
  ) {
    return Result.fail(invalid('order', order, 'invalid-order'))
  }
  if (quote.priceMicros <= 0n || quote.displayedQuantityAtoms < 0n) {
    return Result.fail(invalid('quote', quote, 'invalid-quote'))
  }
  if (
    !Number.isSafeInteger(assumptions.slippageBps) ||
    assumptions.slippageBps < 0 ||
    assumptions.slippageBps > 10_000 ||
    !Number.isSafeInteger(assumptions.availableLiquidityPpm) ||
    assumptions.availableLiquidityPpm <= 0 ||
    assumptions.availableLiquidityPpm > 1_000_000
  ) {
    return Result.fail(invalid('assumptions', assumptions, 'invalid-assumptions'))
  }
  const modelIncrement = modelQuantityIncrement(model.precision.quantityIncrementAtoms)
  const quantityIncrement = order.limitPriceMicros === null ? 1n : quantityScale
  if (
    model.schemaVersion !== 'bayn.execution-model.v5' ||
    model.venue !== 'alpaca-cash-spot' ||
    model.assetClass !== 'cash-spot' ||
    model.order.type !== 'limit' ||
    model.order.timeInForce !== 'ioc' ||
    model.order.extendedHours !== false ||
    modelIncrement !== 1n ||
    quantityIncrement === undefined ||
    model.precision.priceIncrementMicros !== '100'
  ) {
    return Result.fail(invalid('executionModel', model, 'invalid-execution-model'))
  }

  const slippage = BigInt(assumptions.slippageBps)
  const adverseNumerator = quote.priceMicros * (order.side === OrderSide.Buy ? BPS + slippage : BPS - slippage)
  const adversePrice =
    order.side === OrderSide.Buy
      ? quantizeAlpacaLimitPriceMicros((adverseNumerator + BPS - 1n) / BPS, 'UP')
      : quantizeAlpacaLimitPriceMicros(adverseNumerator / BPS, 'DOWN')
  const cancel = (
    reason: CoreCancelReason,
  ): Result.Result<IntradayReplayIocCoreOutcome, IntradayReplayIocCoreFailure> =>
    Result.succeed({
      status: 'canceled',
      adversePriceMicros: adversePrice,
      requestedQuantityAtoms: order.quantityAtoms,
      filledQuantityAtoms: 0n,
      reason,
      unfilledRemainder: 'canceled',
    })
  if (
    order.limitPriceMicros !== null &&
    ((order.side === OrderSide.Buy && adversePrice > order.limitPriceMicros) ||
      (order.side === OrderSide.Sell && adversePrice < order.limitPriceMicros))
  ) {
    return cancel('adverse-price-exceeds-limit')
  }
  const liquidity = (quote.displayedQuantityAtoms * BigInt(assumptions.availableLiquidityPpm)) / PPM
  const fillQuantity = (liquidity / quantityIncrement) * quantityIncrement
  const requestedOrAvailable = fillQuantity < order.quantityAtoms ? fillQuantity : order.quantityAtoms
  if (order.limitPriceMicros === null && requestedOrAvailable < order.quantityAtoms)
    return Result.fail(
      invalid('quote.displayedQuantityAtoms', quote.displayedQuantityAtoms, 'insufficient-market-close-liquidity'),
    )
  if (requestedOrAvailable === 0n) {
    return cancel(liquidity === 0n ? 'no-displayed-liquidity' : 'zero-after-whole-share-rounding')
  }
  return notionalMicros(requestedOrAvailable, adversePrice).pipe(
    Result.mapError(() =>
      invalid('notional', { quantityAtoms: requestedOrAvailable, priceMicros: adversePrice }, 'invalid-notional'),
    ),
    Result.map(
      (fillNotionalMicros): IntradayReplayIocCoreOutcome => ({
        status: 'filled',
        requestedQuantityAtoms: order.quantityAtoms,
        filledQuantityAtoms: requestedOrAvailable,
        fillPriceMicros: adversePrice,
        fillNotionalMicros,
        unfilledRemainder: requestedOrAvailable < order.quantityAtoms ? 'canceled' : 'none',
      }),
    ),
  )
}

export const simulateIntradayReplayIocCore = (input: IntradayReplayIocCoreInput) => simulateExecution(input)

/** A close-only market sell needs sufficient observed liquidity; a DAY remainder is never invented as an IOC cancel. */
export const simulateIntradayReplayMarketCloseCore = (
  input: Omit<IntradayReplayIocCoreInput, 'order'> & {
    readonly quantityAtoms: bigint
  },
) =>
  simulateExecution({
    ...input,
    order: { side: OrderSide.Sell, quantityAtoms: input.quantityAtoms, limitPriceMicros: null },
  })

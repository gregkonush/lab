import { Result } from 'effect'
import { quantityScale } from '../quantity'

import { quantizeInstrumentPriceMicros } from '../broker/alpaca-price'
import { instrumentMarket, MarketKind } from '../instruments'
import { orderPriceBoundaryMicros, type OrderRequestError } from '../broker/alpaca-mutations'
import type { ExecutionModel } from '../execution-model-contract'
import { makeFillTerms, MICROS, type ExecutionModelFailure } from '../execution-model'
import { OrderSide, OrderType, TimeInForce } from './contracts'

export interface ExecutionIntentPricingInput {
  readonly symbol: string
  readonly side: OrderSide
  readonly orderType: OrderType
  readonly timeInForce: TimeInForce
  readonly quantityAtoms: bigint
  readonly referencePriceMicros: bigint
  readonly executionModel: ExecutionModel
  readonly limitSlippageBps: bigint
}

export interface ExecutionIntentPricing {
  readonly expectedExecutionPriceMicros: bigint
  readonly notionalLimitMicros: bigint
}

export type ExecutionIntentPricingFailure =
  | ExecutionModelFailure
  | OrderRequestError
  | {
      readonly _tag: 'UnsupportedExecutionTerms'
      readonly orderType: OrderType
      readonly timeInForce: TimeInForce
    }
  | {
      readonly _tag: 'InvalidQuoteBoundIntent'
      readonly reason: 'invalid-quantity-or-price' | 'fractional-quantity' | 'invalid-slippage'
      readonly quantityAtoms: bigint
      readonly referencePriceMicros: bigint
    }

export const deriveExecutionIntentPricing = (
  input: ExecutionIntentPricingInput,
): Result.Result<ExecutionIntentPricing, ExecutionIntentPricingFailure> => {
  if (
    input.orderType === OrderType.Market &&
    input.timeInForce ===
      (instrumentMarket(input.symbol) === MarketKind.Crypto ? TimeInForce.GoodUntilCanceled : TimeInForce.Day)
  ) {
    return Result.map(
      makeFillTerms(
        input.side === OrderSide.Buy ? 'buy' : 'sell',
        input.quantityAtoms,
        input.referencePriceMicros,
        input.executionModel,
        MICROS,
      ),
      (terms) => ({
        expectedExecutionPriceMicros: terms.fillPriceMicros,
        notionalLimitMicros: terms.notionalMicros,
      }),
    )
  }

  if (input.orderType !== OrderType.Limit || input.timeInForce !== TimeInForce.ImmediateOrCancel) {
    return Result.fail({
      _tag: 'UnsupportedExecutionTerms',
      orderType: input.orderType,
      timeInForce: input.timeInForce,
    })
  }
  if (input.quantityAtoms <= 0n || input.referencePriceMicros <= 0n) {
    return Result.fail({
      _tag: 'InvalidQuoteBoundIntent',
      reason: 'invalid-quantity-or-price',
      quantityAtoms: input.quantityAtoms,
      referencePriceMicros: input.referencePriceMicros,
    })
  }
  if (instrumentMarket(input.symbol) === MarketKind.Equity && input.quantityAtoms % quantityScale !== 0n) {
    return Result.fail({
      _tag: 'InvalidQuoteBoundIntent',
      reason: 'fractional-quantity',
      quantityAtoms: input.quantityAtoms,
      referencePriceMicros: input.referencePriceMicros,
    })
  }
  if (input.limitSlippageBps < 0n || input.limitSlippageBps >= 10_000n) {
    return Result.fail({
      _tag: 'InvalidQuoteBoundIntent',
      reason: 'invalid-slippage',
      quantityAtoms: input.quantityAtoms,
      referencePriceMicros: input.referencePriceMicros,
    })
  }
  const buy = input.side === OrderSide.Buy
  const boundary = input.referencePriceMicros * (10_000n + (buy ? input.limitSlippageBps : -input.limitSlippageBps))
  const price =
    input.limitSlippageBps === 0n
      ? input.referencePriceMicros
      : quantizeInstrumentPriceMicros(input.symbol, (boundary + (buy ? 0n : 9_999n)) / 10_000n, buy ? 'DOWN' : 'UP')
  const roundUp = input.limitSlippageBps === 0n ? buy : !buy
  const notionalLimitMicros = (input.quantityAtoms * price + (roundUp ? quantityScale - 1n : 0n)) / quantityScale
  return Result.map(
    orderPriceBoundaryMicros({
      symbol: input.symbol,
      side: input.side,
      quantityAtoms: input.quantityAtoms.toString(),
      notionalLimitMicros: notionalLimitMicros.toString(),
    }),
    (expectedExecutionPriceMicros) => ({ expectedExecutionPriceMicros, notionalLimitMicros }),
  )
}

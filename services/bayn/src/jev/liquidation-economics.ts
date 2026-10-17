import { Result } from 'effect'

import { OrderSide, OrderType } from '../execution/contracts'
import { deriveExecutionIntentPricing } from '../execution/intent-pricing'
import { cashSpotLimitTimeInForce } from '../execution/order-terms'
import { instrumentMarket, MarketKind } from '../instruments'
import { quantityScale } from '../quantity'
import { calculateSessionFees, cryptoTakerFeeSchedule } from '../strategy/execution-model/fees'
import { JevContractError } from './contract'
import type { JevProtocol } from './protocol'

interface LiquidationInput {
  readonly protocol: JevProtocol
  readonly symbol: string
  readonly quantityAtoms: bigint
}

export const jevLiquidationValue = (input: LiquidationInput & { readonly bidMicros: bigint }) =>
  Result.gen(function* () {
    const pricing = yield* deriveExecutionIntentPricing({
      symbol: input.symbol,
      side: OrderSide.Sell,
      orderType: OrderType.Limit,
      timeInForce: cashSpotLimitTimeInForce(instrumentMarket(input.symbol)),
      quantityAtoms: input.quantityAtoms,
      referencePriceMicros: input.bidMicros,
      executionModel: input.protocol.executionModel,
      limitSlippageBps: BigInt(input.protocol.maximumEntryLimitSlippageBps),
    })
    const proceedsMicros = (pricing.expectedExecutionPriceMicros * input.quantityAtoms) / quantityScale
    const fees = yield* calculateSessionFees(
      [{ symbol: input.symbol, side: 'sell', quantityAtoms: input.quantityAtoms, notionalMicros: proceedsMicros }],
      input.protocol.executionModel,
      1_000_000n,
    )
    return { proceedsMicros, feesMicros: fees.cashMicros, netMicros: proceedsMicros - fees.cashMicros }
  }).pipe(
    Result.mapError(
      (cause) => new JevContractError({ message: 'Jev liquidation economics could not be estimated', cause }),
    ),
  )

export const jevBreakEvenExitBid = (
  input: LiquidationInput & { readonly acquisitionCostMicros: bigint; readonly upperBidMicros: bigint },
) =>
  Result.gen(function* () {
    const fees = input.protocol.executionModel.fees
    // A rounded fee can jump faster than proceeds. Reserve each price-dependent fee's rounding increment.
    const roundingReserve =
      instrumentMarket(input.symbol) === MarketKind.Crypto
        ? BigInt(cryptoTakerFeeSchedule.cashRoundingMicros)
        : BigInt(fees.roundingIncrementMicros) * BigInt(Number(fees.commissionBps > 0) + Number(fees.secSellBps > 0))
    const requiredCash = input.acquisitionCostMicros + roundingReserve
    let low = 1n
    let high = input.upperBidMicros
    if ((yield* jevLiquidationValue({ ...input, bidMicros: high })).netMicros < requiredCash)
      return yield* Result.fail(new JevContractError({ message: 'Liquidation has no bounded break-even bid' }))
    while (low < high) {
      const middle = (low + high) / 2n
      if ((yield* jevLiquidationValue({ ...input, bidMicros: middle })).netMicros >= requiredCash) high = middle
      else low = middle + 1n
    }
    return low
  })

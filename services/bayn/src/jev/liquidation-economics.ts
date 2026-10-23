import { Result } from 'effect'

import { OrderSide, OrderType } from '../execution/contracts'
import { deriveExecutionIntentPricing } from '../execution/intent-pricing'
import { cashSpotLimitTimeInForce } from '../execution/order-terms'
import { instrumentMarket, MarketKind } from '../instruments'
import { quantityScale } from '../quantity'
import { calculateSessionFees, cryptoTakerFeeSchedule } from '../strategy/execution-model/fees'
import { scaledNumber } from '../strategy/execution-model/fixed-point'
import { JevContractError } from './contract'
import type { JevProtocol } from './protocol'

interface LiquidationInput {
  readonly protocol: JevProtocol
  readonly symbol: string
  readonly costMultiplierMicros?: bigint
  readonly quantityAtoms: bigint
}

export const jevLiquidationValue = (input: LiquidationInput & { readonly bidMicros: bigint }) =>
  Result.gen(function* () {
    const market = instrumentMarket(input.symbol)
    const pricing = yield* deriveExecutionIntentPricing({
      symbol: input.symbol,
      side: OrderSide.Sell,
      orderType: OrderType.Limit,
      timeInForce: cashSpotLimitTimeInForce(market),
      quantityAtoms: input.quantityAtoms,
      referencePriceMicros: input.bidMicros,
      limitSlippageBps: BigInt(input.protocol.maximumEntryLimitSlippageBps),
    })
    const proceedsMicros = (pricing.expectedExecutionPriceMicros * input.quantityAtoms) / quantityScale
    const fees = yield* calculateSessionFees(
      [{ symbol: input.symbol, side: 'sell', quantityAtoms: input.quantityAtoms, notionalMicros: proceedsMicros }],
      input.protocol.executionModel,
      input.costMultiplierMicros ?? 1_000_000n,
    )
    const schedule = input.protocol.executionModel.fees
    const crypto = instrumentMarket(input.symbol) === MarketKind.Crypto
    const variableRate = crypto
      ? BigInt(cryptoTakerFeeSchedule.takerBps) * 1_000_000n
      : (yield* scaledNumber(schedule.commissionBps, 'commission bps')) +
        (yield* scaledNumber(schedule.secSellBps, 'SEC sell bps'))
    const roundingReserve = crypto
      ? BigInt(cryptoTakerFeeSchedule.cashRoundingMicros)
      : BigInt(schedule.roundingIncrementMicros) *
        BigInt(Number(schedule.commissionBps > 0) + Number(schedule.secSellBps > 0))
    const fixedFees = crypto ? 0n : fees.cashMicros - fees.commissionMicros - fees.secMicros
    // One combined linear rate plus rounding reserves bounds stepped fees without making net cash decrease.
    const conservativeFees =
      fixedFees +
      (proceedsMicros * variableRate * (input.costMultiplierMicros ?? 1_000_000n)) / 10_000_000_000_000_000n +
      roundingReserve
    return {
      proceedsMicros,
      feesMicros: fees.cashMicros,
      netMicros: proceedsMicros - fees.cashMicros,
      conservativeNetMicros: proceedsMicros - conservativeFees,
    }
  }).pipe(
    Result.mapError(
      (cause) => new JevContractError({ message: 'Jev liquidation economics could not be estimated', cause }),
    ),
  )

export const jevBreakEvenExitBid = (
  input: LiquidationInput & { readonly acquisitionCostMicros: bigint; readonly upperBidMicros: bigint },
) =>
  Result.gen(function* () {
    let low = 1n
    let high = input.upperBidMicros
    if ((yield* jevLiquidationValue({ ...input, bidMicros: high })).conservativeNetMicros < input.acquisitionCostMicros)
      return yield* Result.fail(new JevContractError({ message: 'Liquidation has no bounded break-even bid' }))
    while (low < high) {
      const middle = (low + high) / 2n
      if (
        (yield* jevLiquidationValue({ ...input, bidMicros: middle })).conservativeNetMicros >=
        input.acquisitionCostMicros
      )
        high = middle
      else low = middle + 1n
    }
    return low
  })

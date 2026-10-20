import { Result } from 'effect'

import { deriveExecutionIntentPricing } from '../execution/intent-pricing'
import { OrderSide, OrderType } from '../execution/contracts'
import { cashSpotLimitTimeInForce } from '../execution/order-terms'
import { instrumentMarket } from '../instruments'
import { quantityScale } from '../quantity'
import { calculateSessionFees, receivedCryptoFee } from '../strategy/execution-model/fees'
import { JevContractError } from './contract'
import { maximumAllocatedBuyQuantities } from './entry-sizing'
import { jevBreakEvenExitBid, jevLiquidationValue } from './liquidation-economics'
import type { JevProtocol } from './protocol'

export const jevMaximumEntryAskMicros = (protocol: JevProtocol, observedAsk: bigint): bigint =>
  (observedAsk * BigInt(10_000 + protocol.maximumEntryQuoteDriftBps)) / 10_000n

export const jevEntryEconomics = (input: {
  readonly protocol: JevProtocol
  readonly symbol: string
  readonly bidMicros: bigint
  readonly askMicros: bigint
  readonly capitalMicros: string
}) =>
  Result.gen(function* () {
    const { protocol, symbol } = input
    const pricing = yield* deriveExecutionIntentPricing({
      symbol,
      side: OrderSide.Buy,
      orderType: OrderType.Limit,
      timeInForce: cashSpotLimitTimeInForce(instrumentMarket(symbol)),
      quantityAtoms: quantityScale,
      referencePriceMicros: jevMaximumEntryAskMicros(protocol, input.askMicros),
      limitSlippageBps: BigInt(protocol.maximumEntryLimitSlippageBps),
    })
    const maximumEntryPrice = pricing.expectedExecutionPriceMicros
    const quantities = yield* maximumAllocatedBuyQuantities({
      askPriceMicros: { [symbol]: maximumEntryPrice.toString() },
      targetWeights: { [symbol]: Math.min(protocol.maximumGrossWeight, protocol.maximumSymbolWeight) },
      capitalMicros: input.capitalMicros,
      precision: protocol.executionModel.precision,
    })
    const quantity = BigInt(quantities[symbol] ?? '0')
    if (quantity <= 0n) return null
    const buy = {
      symbol,
      side: 'buy' as const,
      quantityAtoms: quantity,
      notionalMicros: (maximumEntryPrice * quantity + quantityScale - 1n) / quantityScale,
    }
    const entryFees = yield* calculateSessionFees([buy], protocol.executionModel, 1_000_000n)
    const received = quantity - receivedCryptoFee(buy, 1_000_000n).quantityAtoms
    const acquisitionCost = buy.notionalMicros + entryFees.cashMicros
    const liquidation = { protocol, symbol, quantityAtoms: received }
    const breakEvenBid = yield* jevBreakEvenExitBid({
      ...liquidation,
      acquisitionCostMicros: acquisitionCost,
      upperBidMicros: maximumEntryPrice * 2n,
    })
    const exit = yield* jevLiquidationValue({ ...liquidation, bidMicros: breakEvenBid })
    return {
      maximumEntryPriceUsd: Number(maximumEntryPrice) / 1_000_000,
      assumedEntryQuantity: Number(quantity) / Number(quantityScale),
      estimatedEntryFeesUsd: Number(entryFees.totalMicros) / 1_000_000,
      estimatedExitFeesAtBreakEvenUsd: Number(exit.feesMicros) / 1_000_000,
      breakEvenExitBidUsd: Number(breakEvenBid) / 1_000_000,
      requiredBidRiseBps: Number(((breakEvenBid - input.bidMicros) * 10_000_000n) / input.bidMicros) / 1000,
      maximumEntryQuoteDriftBps: protocol.maximumEntryQuoteDriftBps,
      maximumEntryLimitSlippageBps: protocol.maximumEntryLimitSlippageBps,
      operatingCostCoverage: 'UNKNOWN',
    }
  }).pipe(
    Result.mapError((cause) => new JevContractError({ message: 'Jev entry economics could not be estimated', cause })),
  )

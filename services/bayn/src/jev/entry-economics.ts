import { Result } from 'effect'

import { deriveExecutionIntentPricing } from '../execution/intent-pricing'
import { OrderSide, OrderType } from '../execution/contracts'
import { cashSpotLimitTimeInForce } from '../execution/order-terms'
import { instrumentMarket, MarketKind } from '../instruments'
import type { IntradayBar } from '../market-data/intraday/model'
import { quantityScale } from '../quantity'
import { calculateSessionFees, receivedCryptoFee } from '../strategy/execution-model/fees'
import { JevContractError } from './contract'
import { maximumAllocatedBuyQuantities } from './entry-sizing'
import { jevBreakEvenExitBid, jevLiquidationValue } from './liquidation-economics'
import type { JevProtocol } from './protocol'
import { deriveJevStrategyExitPlan, type JevFundedExitPlan } from './strategy-exit-plan'

export const jevMaximumEntryAskMicros = (protocol: JevProtocol, observedAsk: bigint): bigint =>
  (observedAsk * BigInt(10_000 + protocol.maximumEntryQuoteDriftBps)) / 10_000n

export const jevEntryEconomics = (input: {
  readonly protocol: JevProtocol
  readonly symbol: string
  readonly bidMicros: bigint
  readonly askMicros: bigint
  readonly capitalMicros: string
  readonly bars: readonly Pick<IntradayBar, 'symbol' | 'eventAt' | 'open' | 'high' | 'low' | 'close' | 'final'>[]
  readonly sourceEndAt: string
}) =>
  Result.gen(function* () {
    const { protocol, symbol } = input
    const maximumAsk = jevMaximumEntryAskMicros(protocol, input.askMicros)
    const maximumEntryPrice = (yield* deriveExecutionIntentPricing({
      symbol,
      side: OrderSide.Buy,
      orderType: OrderType.Limit,
      timeInForce: cashSpotLimitTimeInForce(instrumentMarket(symbol)),
      quantityAtoms: quantityScale,
      referencePriceMicros: maximumAsk,
      limitSlippageBps: BigInt(protocol.maximumEntryLimitSlippageBps),
    })).expectedExecutionPriceMicros
    const levels = yield* deriveJevStrategyExitPlan({
      symbol,
      bars: input.bars,
      sourceEndAt: input.sourceEndAt,
      maximumEntryPriceMicros: maximumEntryPrice,
      maximumHoldingMinutes: protocol.maximumHoldingMinutes,
      maximumStopBps: protocol.maximumStopBps,
      stopLimitSlippageBps: protocol.maximumEntryLimitSlippageBps,
    })
    if (levels._tag === 'Excluded' || input.bidMicros <= BigInt(levels.plan.stopPriceMicros)) return null
    const capital = BigInt(input.capitalMicros)
    const budget = (capital * BigInt(protocol.maximumCapitalRiskBps)) / 10_000n
    if (budget <= 0n) return null
    const quantities = yield* maximumAllocatedBuyQuantities({
      askPriceMicros: { [symbol]: maximumEntryPrice.toString() },
      targetWeights: { [symbol]: Math.min(protocol.maximumGrossWeight, protocol.maximumSymbolWeight) },
      capitalMicros: input.capitalMicros,
      precision: protocol.executionModel.precision,
    })
    const increment =
      instrumentMarket(symbol) === MarketKind.Equity
        ? quantityScale
        : BigInt(protocol.executionModel.precision.quantityIncrementAtoms)
    const estimate = (quantityAtoms: bigint) =>
      Result.gen(function* () {
        const buy = {
          symbol,
          side: 'buy' as const,
          quantityAtoms,
          notionalMicros: (maximumEntryPrice * quantityAtoms + quantityScale - 1n) / quantityScale,
        }
        const fees = yield* calculateSessionFees([buy], protocol.executionModel, 1_000_000n)
        const received = quantityAtoms - receivedCryptoFee(buy, 1_000_000n).quantityAtoms
        const acquisitionCost = buy.notionalMicros + fees.cashMicros
        const liquidation = { protocol, symbol, quantityAtoms: received }
        const stop = yield* jevLiquidationValue({ ...liquidation, bidMicros: BigInt(levels.plan.stopPriceMicros) })
        const target = yield* jevLiquidationValue({
          ...liquidation,
          bidMicros: BigInt(levels.plan.profitLimitPriceMicros),
        })
        return { fees, received, acquisitionCost, stop, target, loss: acquisitionCost - stop.conservativeNetMicros }
      })
    let low = 0n
    let high = BigInt(quantities[symbol] ?? '0') / increment
    while (low < high) {
      const middle = (low + high + 1n) / 2n
      const risk = yield* estimate(middle * increment)
      if (risk.loss <= budget) low = middle
      else high = middle - 1n
    }
    const quantity = low * increment
    if (quantity <= 0n) return null
    const costs = yield* estimate(quantity)
    if (costs.loss <= 0n || costs.target.conservativeNetMicros <= costs.acquisitionCost) return null
    const weightDenominator = quantityScale * capital
    const maximumTargetWeight =
      Number((quantity * maximumEntryPrice * 1_000_000n + weightDenominator - 1n) / weightDenominator) / 1_000_000
    if (maximumTargetWeight <= 0) return null
    const exitPlan: JevFundedExitPlan = {
      schemaVersion: 'bayn.jev-funded-exit-plan.v1',
      levels: levels.plan,
      maximumQuantityAtoms: quantity.toString(),
      acquisitionCostMicros: costs.acquisitionCost.toString(),
      estimatedStopNetMicros: costs.stop.conservativeNetMicros.toString(),
      estimatedTargetNetMicros: costs.target.conservativeNetMicros.toString(),
      capitalRiskBudgetMicros: budget.toString(),
    }
    const breakEvenBid = yield* jevBreakEvenExitBid({
      protocol,
      symbol,
      quantityAtoms: costs.received,
      acquisitionCostMicros: costs.acquisitionCost,
      upperBidMicros: maximumEntryPrice * 2n,
    })
    const breakEvenLiquidation = yield* jevLiquidationValue({
      protocol,
      symbol,
      quantityAtoms: costs.received,
      bidMicros: breakEvenBid,
    })
    return {
      exitPlan,
      maximumTargetWeight,
      profitTargetExitBidUsd: Number(levels.plan.profitLimitPriceMicros) / 1_000_000,
      stopPriceUsd: Number(levels.plan.stopPriceMicros) / 1_000_000,
      stopLimitPriceUsd: Number(levels.plan.stopLimitPriceMicros) / 1_000_000,
      estimatedStopLossUsd: Number(costs.loss) / 1_000_000,
      estimatedTargetProfitUsd: Number(costs.target.conservativeNetMicros - costs.acquisitionCost) / 1_000_000,
      maximumHoldingMinutes: protocol.maximumHoldingMinutes,
      maximumEntryPriceUsd: Number(maximumEntryPrice) / 1_000_000,
      assumedEntryQuantity: Number(quantity) / Number(quantityScale),
      estimatedEntryFeesUsd: Number(costs.fees.totalMicros) / 1_000_000,
      estimatedExitFeesAtBreakEvenUsd: Number(breakEvenLiquidation.feesMicros) / 1_000_000,
      breakEvenExitBidUsd: Number(breakEvenBid) / 1_000_000,
      requiredBidRiseBps: Number(((breakEvenBid - input.bidMicros) * 10_000_000n) / input.bidMicros) / 1000,
      maximumEntryQuoteDriftBps: protocol.maximumEntryQuoteDriftBps,
      maximumEntryLimitSlippageBps: protocol.maximumEntryLimitSlippageBps,
      operatingCostCoverage: 'UNKNOWN',
    }
  }).pipe(
    Result.mapError((cause) => new JevContractError({ message: 'Jev entry economics could not be estimated', cause })),
  )

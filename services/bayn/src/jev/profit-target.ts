import { jevProfitTargetProceeds } from './exit-policy'
import { Result } from 'effect'

import { quantityScale } from '../quantity'
import { calculateSessionFees, receivedCryptoFee } from '../strategy/execution-model/fees'
import { roundUnsignedHalfUp } from '../unsigned-round-half-up'
import { JevContractError } from './contract'
import { jevBreakEvenExitBid, jevLiquidationValue } from './liquidation-economics'
import type { JevManagedPortfolio } from './portfolio'
import type { JevProtocol } from './protocol'

export const jevPositionProfitTarget = (protocol: JevProtocol, portfolio: JevManagedPortfolio) =>
  Result.gen(function* () {
    const fills = []
    let observedCashFees = 0n
    for (const fill of portfolio.entryFills) {
      fills.push({
        symbol: fill.symbol,
        side: 'buy' as const,
        quantityAtoms: BigInt(fill.quantityAtoms),
        notionalMicros: yield* roundUnsignedHalfUp(
          BigInt(fill.quantityAtoms) * BigInt(fill.priceAtoms),
          1_000_000_000_000n,
        ),
      })
      observedCashFees += BigInt(fill.feeMicros)
    }
    const first = fills[0]
    const held = portfolio.brokerState.positions.find((position) => BigInt(position.quantityAtoms) > 0n)
    if (first === undefined || held === undefined)
      return yield* Result.fail(new JevContractError({ message: 'Profit target requires the accounted entry fills' }))
    const fees = yield* calculateSessionFees(fills, protocol.executionModel, 1_000_000n)
    const estimatedCoinDebit = fills.reduce((sum, fill) => sum + receivedCryptoFee(fill, 1_000_000n).quantityAtoms, 0n)
    const postedCoinDebit = BigInt(portfolio.entryInventoryDebit.quantityAtoms)
    const received =
      fills.reduce((sum, fill) => sum + fill.quantityAtoms, 0n) -
      (estimatedCoinDebit > postedCoinDebit ? estimatedCoinDebit : postedCoinDebit)
    const heldQuantity = BigInt(held.quantityAtoms)
    const quantityAtoms = received < heldQuantity ? received : heldQuantity
    if (quantityAtoms <= 0n)
      return yield* Result.fail(new JevContractError({ message: 'Profit target has no quantity after entry fees' }))
    const acquisitionCostMicros =
      fills.reduce((sum, fill) => sum + fill.notionalMicros, 0n) +
      (fees.cashMicros > observedCashFees ? fees.cashMicros : observedCashFees)
    const minimumNetProceedsMicros = jevProfitTargetProceeds(
      acquisitionCostMicros,
      portfolio.exitPolicy.profitTargetNetBps,
    )
    const profitMicros = minimumNetProceedsMicros - acquisitionCostMicros
    return {
      symbol: held.symbol,
      quantityAtoms,
      acquisitionCostMicros,
      minimumNetProceedsMicros,
      profitMicros,
    }
  }).pipe(
    Result.mapError((cause) => new JevContractError({ message: 'Accounted position profit target is invalid', cause })),
  )

export const jevProfitTargetCrossed = (protocol: JevProtocol, portfolio: JevManagedPortfolio, bidMicros: bigint) =>
  Result.gen(function* () {
    const target = yield* jevPositionProfitTarget(protocol, portfolio)
    const liquidation = yield* jevLiquidationValue({ protocol, ...target, bidMicros })
    return liquidation.conservativeNetMicros >= target.minimumNetProceedsMicros
  })

export const jevProfitTargetBid = (protocol: JevProtocol, portfolio: JevManagedPortfolio) =>
  Result.gen(function* () {
    const target = yield* jevPositionProfitTarget(protocol, portfolio)
    return yield* jevBreakEvenExitBid({
      protocol,
      ...target,
      acquisitionCostMicros: target.minimumNetProceedsMicros,
      upperBidMicros: ((target.minimumNetProceedsMicros * quantityScale) / target.quantityAtoms + 1n) * 2n,
    })
  })

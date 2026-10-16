import { Result } from 'effect'

import { instrumentMarket, MarketKind } from '../instruments'
import type { ExecutionModel } from '../execution-model-contract'
import { quantityScale } from '../quantity'
import { desiredQuantityAtoms } from '../strategy/execution-model/fixed-point'
import { JevContractError } from './contract'

export const maximumAllocatedBuyQuantities = (input: {
  readonly askPriceMicros: Readonly<Record<string, string>>
  readonly targetWeights: Readonly<Record<string, number>>
  readonly capitalMicros: string
  readonly precision: ExecutionModel['precision']
}) =>
  Result.gen(function* () {
    const quantities: Record<string, string> = {}
    for (const [symbol, weight] of Object.entries(input.targetWeights).sort(([a], [b]) => a.localeCompare(b))) {
      quantities[symbol] =
        weight === 0
          ? '0'
          : (yield* desiredQuantityAtoms(
              BigInt(input.capitalMicros),
              weight,
              BigInt(input.askPriceMicros[symbol] ?? '0'),
              {
                precision: {
                  ...input.precision,
                  quantityIncrementAtoms:
                    instrumentMarket(symbol) === MarketKind.Equity
                      ? quantityScale.toString()
                      : input.precision.quantityIncrementAtoms,
                },
              },
            ).pipe(
              Result.mapError(
                (cause) =>
                  new JevContractError({ message: `Allocated entry quantity for ${symbol} is invalid`, cause }),
              ),
            )).toString()
    }
    return Object.freeze(quantities)
  })

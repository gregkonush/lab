import type { JevInstructions } from './instructions-contract'

export const jevInstructions: JevInstructions = {
  entry:
    'Using `candidate`, `benchmark`, `relativeSignals`, `entryEconomics` and `session`, choose enter, wait or avoid for a new long position in `candidate.symbol` now over `task.horizonMinutes`. There is no required positive return or benchmark outperformance. Judge whether the supplied market evidence supports the entry after estimated execution costs. Execution remains conditional on separately selected and validated stop loss and take profit prices. Code owns permission, quantity, execution and account risk limits.',
  stopLoss:
    'Assume a new long position in `candidate.symbol` is entered now under `entryEconomics`, with a holding horizon of `task.horizonMinutes`. Using `candidate`, `benchmark` and `relativeSignals`, select the supplied observed price below `candidate.quote.bid` at which the market evidence would invalidate that long thesis. Choose none if the evidence does not support any supplied stop price. No positive return or benchmark outperformance is required. Code uses this speculative answer only when entering a long position is separately supported.',
  takeProfit:
    'Assume a new long position in `candidate.symbol` is entered now under `entryEconomics`, with a holding horizon of `task.horizonMinutes`. Using `candidate`, `benchmark` and `relativeSignals`, select the supplied observed price above `entryEconomics.maximumEntryPriceUsd` that the evidence supports reaching to realize a profit after estimated execution costs. Consider `entryEconomics.breakEvenExitBidUsd`. Choose none if no supplied price is supported or covers estimated costs. Code uses this speculative answer only when entering a long position is separately supported.',
}

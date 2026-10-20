import { Result, Schema } from 'effect'

import { quantizeInstrumentPriceMicros } from '../broker/alpaca-price'
import type { StrategyMarketSnapshot } from '../market-data/streaming/snapshot'
import { priceNumberToMicros } from '../strategy/execution-model/fixed-point'
import { JevContractError, type JevRequest, type JevResponse } from './contract'
import { JevStrategyExitPlanSchema } from './strategy-exit-plan'
import type { JevProtocol } from './protocol'

/** Choice values are observed prices, never a fabricated percentage or range extension. */
export const jevTradePriceQuestions = (input: {
  readonly snapshot: StrategyMarketSnapshot
  readonly symbol: string
  readonly maximumEntryPriceMicros: bigint
}) =>
  Result.gen(function* () {
    const { snapshot, symbol } = input
    const values = snapshot.bars
      .filter((bar) => bar.symbol === symbol)
      .flatMap((bar) => [bar.open, bar.high, bar.low, bar.close])
    const quote = snapshot.latestQuotes[symbol]
    if (quote === undefined)
      return yield* Result.fail(new JevContractError({ message: 'Model trade prices require a verified quote' }))
    const bid = yield* priceNumberToMicros(quote.bidPrice, 'bid', 'DOWN')
    const questions: Record<string, JevRequest['questions'][string]> = {}
    for (const role of ['stop_loss', 'take_profit'] as const) {
      const prices = new Set<string>()
      for (const value of values) {
        const price = quantizeInstrumentPriceMicros(
          symbol,
          yield* priceNumberToMicros(value, 'observed trade price', role === 'stop_loss' ? 'DOWN' : 'UP'),
          role === 'stop_loss' ? 'DOWN' : 'UP',
        )
        if (price > 0n && (role === 'stop_loss' ? price < bid : price > input.maximumEntryPriceMicros))
          prices.add(price.toString())
      }
      if (prices.size === 0) continue
      if (prices.size > 254)
        return yield* Result.fail(
          new JevContractError({ message: 'Observed trade prices exceed the Jev Choice limit' }),
        )
      const criteria = Object.fromEntries(
        [...prices]
          .sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : 1))
          .map((price) => [`price_${price}`, { priceUsd: Number(price) / 1_000_000, priceMicros: price }]),
      )
      questions[role] = {
        type: 'choice',
        instructions:
          role === 'stop_loss'
            ? 'Assume a new long position in `candidate.symbol` is entered now under `entryEconomics`, with a holding horizon of `task.horizonMinutes`. Using `candidate`, `benchmark` and `relativeSignals`, select the supplied observed price below `candidate.quote.bid` at which the market evidence would invalidate that long thesis. Choose none if the evidence does not support any supplied stop price. No positive return or benchmark outperformance is required. Code uses this speculative answer only when entering a long position is separately supported.'
            : 'Assume a new long position in `candidate.symbol` is entered now under `entryEconomics`, with a holding horizon of `task.horizonMinutes`. Using `candidate`, `benchmark` and `relativeSignals`, select the supplied observed price above `entryEconomics.maximumEntryPriceUsd` that the evidence supports reaching to realize a profit after estimated execution costs. Consider `entryEconomics.breakEvenExitBidUsd`. Choose none if no supplied price is supported or covers estimated costs. Code uses this speculative answer only when entering a long position is separately supported.',
        criteria: { none: 'No supplied price supports this trade.', ...criteria },
      }
    }
    return questions
  })

export const selectedJevTradeLevels = (input: {
  readonly request: JevRequest
  readonly response: JevResponse
  readonly symbol: string
  readonly bidMicros: bigint
  readonly maximumEntryPriceMicros: bigint
  readonly sourceStartAt: string
  readonly sourceEndAt: string
  readonly protocol: JevProtocol
}) =>
  Result.gen(function* () {
    const prices: bigint[] = []
    for (const role of ['stop_loss', 'take_profit']) {
      const answer = input.response.answers[role]
      const question = input.request.questions[role]
      if (answer?.type !== 'choice' || question?.type !== 'choice' || answer.choice === 'none') return null
      const selected = question.criteria[answer.choice]
      if (
        selected === null ||
        typeof selected !== 'object' ||
        Array.isArray(selected) ||
        !('priceMicros' in selected) ||
        typeof selected['priceMicros'] !== 'string' ||
        !/^[1-9][0-9]*$/.test(selected['priceMicros'])
      )
        return yield* Result.fail(
          new JevContractError({ message: 'Jev selected a price outside its sealed request', question: role }),
        )
      prices.push(BigInt(selected['priceMicros']))
    }
    const [stop, profit] = prices
    if (
      stop === undefined ||
      profit === undefined ||
      stop >= input.bidMicros ||
      stop >= input.maximumEntryPriceMicros ||
      profit <= input.maximumEntryPriceMicros
    )
      return null
    const stopLimit = quantizeInstrumentPriceMicros(
      input.symbol,
      (stop * BigInt(10_000 - input.protocol.maximumEntryLimitSlippageBps) + 9_999n) / 10_000n,
      'UP',
    )
    return yield* Schema.decodeUnknownResult(JevStrategyExitPlanSchema)({
      schemaVersion: 'bayn.jev-strategy-exit-plan.v2',
      rule: 'model-selected-observed-prices',
      symbol: input.symbol,
      sourceStartAt: input.sourceStartAt,
      sourceEndAt: input.sourceEndAt,
      maximumHoldingMinutes: input.protocol.maximumHoldingMinutes,
      maximumEntryPriceMicros: input.maximumEntryPriceMicros.toString(),
      stopPriceMicros: stop.toString(),
      stopLimitPriceMicros: stopLimit.toString(),
      profitLimitPriceMicros: profit.toString(),
    }).pipe(
      Result.mapError(
        (cause) => new JevContractError({ message: 'Jev trade prices are not valid protection terms', cause }),
      ),
    )
  })

import { expect, test } from 'bun:test'
import { Result } from 'effect'
import fc from 'fast-check'

import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { decideJevEntry } from './decision'
import { jevObservationForSnapshot, nativeJevDecisionEvidence, nativeJevFixture } from './native.test-support'
import { JevPurpose } from './portfolio'
import { makeJevTradingSignalRequest } from './trading-signals'
import { checkProperty } from '../testing/property-test-support'
import { jevEntryEconomics } from './entry-economics'
import { maximumAllocatedBuyQuantities } from './entry-sizing'
import { defaultJevProtocolDocument } from './protocol'

test.each(['not_supported', 'uncertain'])('a chosen enter action with %s net economics abstains', (economics) => {
  const evidence = nativeJevDecisionEvidence(undefined, 'enter', 0.8, economics)
  expect(Result.getOrThrow(decideJevEntry(evidence)).selectedSymbols).toEqual([])
})

test('an unfunded whole-equity target abstains even when the model chooses supported economics', () => {
  const fixture = nativeJevFixture(JevPurpose.Entry, undefined, undefined, {
    ...defaultJevProtocolDocument,
    maximumGrossWeight: 0.000001,
    maximumSymbolWeight: 0.000001,
  })
  const evidence = nativeJevDecisionEvidence(fixture)
  expect(Result.getOrThrow(decideJevEntry(evidence)).selectedSymbols).toEqual([])
})

test.each(['BTC/USD', 'ETH/USD', 'SOL/USD'] as const)(
  '%s entry binds a fee break-even bid and price ceiling',
  (symbol) => {
    const { snapshot } = cryptoMarketFixture(symbol)
    const native = Result.getOrThrow(jevObservationForSnapshot(snapshot)).payload
    const request = Result.getOrThrow(makeJevTradingSignalRequest(native, symbol))
    const state = JSON.parse(request.body).state
    expect(state.entryEconomics.operatingCostCoverage).toBe('UNKNOWN')
    expect(state.entryEconomics.breakEvenExitBidUsd).toBeGreaterThan(state.candidate.quote.ask)
    expect(state.entryEconomics.requiredBidRiseBps).toBeGreaterThan(70)
    expect(state.entryEconomics.maximumEntryPriceUsd).toBeGreaterThan(state.candidate.quote.ask)
    expect(request.request.questions['net_economics']?.type).toBe('choice')
  },
)

test('property: crypto break-even bid covers the coin debit and cent-rounded exit fee at the entry price ceiling', () => {
  checkProperty(
    'crypto-entry-break-even',
    fc.property(
      fc.bigInt({ min: 1_000_000n, max: 200_000_000_000n }),
      fc.bigInt({ min: 1_000_000_000n, max: 1_000_000_000_000n }),
      (ask, capital) => {
        const protocol = defaultJevProtocolDocument
        const economics = Result.getOrThrow(
          jevEntryEconomics({
            protocol,
            symbol: 'BTC/USD',
            askMicros: ask,
            bidMicros: ask,
            capitalMicros: String(capital),
          }),
        )
        if (economics === null) throw new Error('Funded crypto fixture requires a positive allocation')
        const entryPrice = BigInt(Math.round(economics.maximumEntryPriceUsd * 1_000_000))
        const quantity = BigInt(
          Result.getOrThrow(
            maximumAllocatedBuyQuantities({
              askPriceMicros: { 'BTC/USD': String(entryPrice) },
              targetWeights: { 'BTC/USD': 0.2 },
              capitalMicros: String(capital),
              precision: protocol.executionModel.precision,
            }),
          )['BTC/USD'] ?? '0',
        )
        const received = quantity - (quantity * 25n + 9999n) / 10_000n
        const acquired = (entryPrice * quantity + 999_999_999n) / 1_000_000_000n
        const net = (bid: bigint) => {
          const proceeds = (bid * received) / 1_000_000_000n
          const fee = ((proceeds * 25n + 99_999_999n) / 100_000_000n) * 10_000n
          return proceeds - fee
        }
        const bid = BigInt(Math.round(economics.breakEvenExitBidUsd * 1_000_000))
        expect(net(bid)).toBeGreaterThanOrEqual(acquired)
        expect(net(bid - 1n)).toBeLessThan(acquired)
        expect(economics.estimatedEntryFeesUsd).toBeGreaterThan(0)
        expect(economics.operatingCostCoverage).toBe('UNKNOWN')
      },
    ),
  )
})

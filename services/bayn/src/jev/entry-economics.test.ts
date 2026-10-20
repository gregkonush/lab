import { expect, test } from 'bun:test'
import { Result } from 'effect'
import fc from 'fast-check'

import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { decideJevEntry } from './decision'
import { jevObservationForSnapshot, nativeJevDecisionEvidence, nativeJevFixture } from './native.test-support'
import { JevPurpose } from './portfolio'
import { makeJevTradingSignalRequest } from './trading-signals'
import { checkProperty } from '../testing/property-test-support'
import { maximumAllocatedBuyQuantities, maximumFundedBuyQuantities } from './entry-sizing'
import { jevEntryEconomics } from './entry-economics'
import { defaultJevProtocolDocument } from './protocol'

test('setup selection asks the model for its setup action without a second economics judgment', () => {
  const fixture = nativeJevFixture()
  const request = Result.getOrThrow(makeJevTradingSignalRequest(fixture.observation.payload, 'AAPL'))
  expect(request.request.questions['net_economics']).toBeUndefined()
  expect(request.request.questions['action']?.instructions).toContain('entryEconomics.profitTargetExitBidUsd')
  const evidence = nativeJevDecisionEvidence(fixture, 'enter', 0.4)
  expect(Result.getOrThrow(decideJevEntry(evidence)).selectedSymbols).toEqual(['AAPL'])
})

test('an unfunded whole-equity target abstains even when the model chooses enter', () => {
  const fixture = nativeJevFixture(JevPurpose.Entry, undefined, undefined, {
    ...defaultJevProtocolDocument,
    maximumGrossWeight: 0.000001,
    maximumSymbolWeight: 0.000001,
  })
  const evidence = nativeJevDecisionEvidence(fixture)
  expect(Result.getOrThrow(decideJevEntry(evidence)).selectedSymbols).toEqual([])
})

test.each(['BTC/USD', 'ETH/USD', 'SOL/USD'] as const)(
  '%s excludes a real source window whose range cannot cover its estimated execution costs',
  (symbol) => {
    const { snapshot } = cryptoMarketFixture(symbol)
    const native = Result.getOrThrow(jevObservationForSnapshot(snapshot)).payload
    const request = Result.getOrThrow(makeJevTradingSignalRequest(native, symbol))
    const state = JSON.parse(request.body).state
    expect(state.entryEconomics).toBeNull()
    expect(request.request.questions['net_economics']).toBeUndefined()
  },
)

test('property: crypto break-even bid covers both adverse limits, the coin debit and cent-rounded exit fee', () => {
  checkProperty(
    'crypto-entry-break-even',
    fc.property(
      fc.bigInt({ min: 1_000_000n, max: 200_000_000_000n }),
      fc.bigInt({ min: 1_000_000_000n, max: 1_000_000_000_000n }),
      (ask, capital) => {
        const protocol = defaultJevProtocolDocument
        const end = Date.parse('2026-10-19T15:00:00.000Z')
        const price = Number(ask) / 1_000_000
        const economics = Result.getOrThrow(
          jevEntryEconomics({
            protocol,
            symbol: 'BTC/USD',
            askMicros: ask,
            bidMicros: ask,
            capitalMicros: String(capital),
            sourceEndAt: new Date(end).toISOString(),
            bars: Array.from({ length: 15 }, (_, i) => ({
              symbol: 'BTC/USD',
              eventAt: new Date(end - (15 - i) * 60_000).toISOString(),
              final: true,
              open: price,
              close: price,
              low: price * 0.99,
              high: price * 1.02,
            })),
          }),
        )
        if (economics === null) throw new Error('Funded crypto fixture requires a positive allocation')
        const entryPrice = BigInt(Math.round(economics.maximumEntryPriceUsd * 1_000_000))
        const quantity = BigInt(economics.exitPlan.maximumQuantityAtoms)
        expect(
          BigInt(economics.exitPlan.acquisitionCostMicros) - BigInt(economics.exitPlan.estimatedStopNetMicros),
        ).toBeLessThanOrEqual(BigInt(economics.exitPlan.capitalRiskBudgetMicros))
        const received = quantity - (quantity * 25n + 9999n) / 10_000n
        const acquired = (entryPrice * quantity + 999_999_999n) / 1_000_000_000n
        const net = (bid: bigint) => {
          const boundary = (bid * 9990n + 9999n) / 10000n
          const proceeds = (boundary * received) / 1_000_000_000n
          const fee = ((proceeds * 25n + 99_999_999n) / 100_000_000n) * 10_000n
          return proceeds - fee
        }
        const bid = BigInt(Math.round(economics.breakEvenExitBidUsd * 1_000_000))
        expect(net(bid)).toBeGreaterThanOrEqual(acquired)
        expect(net(bid - 1n)).toBeLessThan(acquired + 10_000n)
        const centInPrice = (10_000n * 1_000_000_000n + received - 1n) / received
        for (const step of [1n, 5n, 10n, 20n])
          expect(net(bid + (centInPrice * step + 19n) / 20n)).toBeGreaterThanOrEqual(acquired)
        expect(economics.estimatedEntryFeesUsd).toBeGreaterThan(0)
        expect(economics.operatingCostCoverage).toBe('UNKNOWN')
      },
    ),
  )
})

test('a cheaper refreshed crypto ask preserves the funded cap used by durable reproduction', () => {
  const end = '2026-10-19T15:00:00.000Z'
  const economics = Result.getOrThrow(
    jevEntryEconomics({
      protocol: defaultJevProtocolDocument,
      symbol: 'BTC/USD',
      bidMicros: 99990000n,
      askMicros: 100000000n,
      capitalMicros: '100000000000',
      sourceEndAt: end,
      bars: Array.from({ length: 15 }, (_, index) => ({
        symbol: 'BTC/USD',
        eventAt: new Date(Date.parse(end) - (15 - index) * 60000).toISOString(),
        open: 100,
        close: 100,
        high: 101,
        low: 99,
        final: true,
      })),
    }),
  )
  if (economics === null) throw new Error('Expected a funded synthetic setup')
  const input = {
    askPriceMicros: { 'BTC/USD': '99990000' },
    targetWeights: { 'BTC/USD': economics.maximumTargetWeight },
    capitalMicros: '100000000000',
    precision: defaultJevProtocolDocument.executionModel.precision,
  }
  const allocated = Result.getOrThrow(maximumAllocatedBuyQuantities(input))
  expect(BigInt(allocated['BTC/USD'] ?? '0')).toBeGreaterThan(BigInt(economics.exitPlan.maximumQuantityAtoms))
  expect(
    Result.getOrThrow(maximumFundedBuyQuantities({ ...input, plans: { 'BTC/USD': economics.exitPlan } }))['BTC/USD'],
  ).toBe(economics.exitPlan.maximumQuantityAtoms)
  expect(Result.isFailure(maximumFundedBuyQuantities({ ...input, plans: {} }))).toBe(true)
})

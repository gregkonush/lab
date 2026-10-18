import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { OrderSide, OrderStatus, OrderType, TimeInForce } from '../execution/contracts'
import { reconciledStateHash } from '../reconciliation'
import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { jevObservationForSnapshot, nativeJevFixture } from './native.test-support'
import { makeJevObservation } from './observation'
import { JevPurpose } from './portfolio'
import { makeJevTradingSignalRequest } from './trading-signals'

for (const symbol of ['BTC/USD', 'ETH/USD', 'SOL/USD'] as const) {
  test.each([0, 1_230_000])(
    `${symbol} management reports booked coin fees plus cash fill fees %i and net liquidation PnL`,
    (cashFeeMicros) => {
      const { snapshot } = cryptoMarketFixture(symbol)
      const native = Result.getOrThrow(jevObservationForSnapshot(snapshot)).payload
      const broker = native.portfolio.brokerState
      const at = snapshot.manifest.observedAt
      const intentId = '1'.repeat(64)
      const material = {
        ...broker,
        positions: [
          {
            schemaVersion: 'bayn.position.v2' as const,
            accountId: broker.account.accountId,
            symbol,
            quantityAtoms: '99750000000',
            averageEntryPriceMicros: '100000000',
            costBasisMicros: '9975000000',
            marketPriceMicros: '103123457',
            marketValueMicros: '10286564836',
            unrealizedPnlMicros: '311564836',
            observedAt: at,
          },
        ],
        orders: [
          {
            schemaVersion: 'bayn.order.v3' as const,
            accountId: broker.account.accountId,
            symbol,
            intentId,
            brokerOrderId: 'crypto-entry',
            clientOrderId: 'native-crypto-entry',
            side: OrderSide.Buy,
            orderType: OrderType.Limit,
            timeInForce: TimeInForce.ImmediateOrCancel,
            quantityAtoms: '100000000000',
            filledQuantityAtoms: '100000000000',
            limitPriceMicros: '100000000',
            status: OrderStatus.Filled,
            observedAt: at,
          },
        ],
      }
      const hash = Result.getOrThrow(reconciledStateHash(material))
      const observation = Result.getOrThrow(
        makeJevObservation({
          cycleId: native.cycleId,
          authorityGenerationHash: native.authorityGenerationHash,
          protocol: native.protocol,
          snapshot,
          portfolio: {
            purpose: JevPurpose.Manage,
            brokerState: {
              ...material,
              reconciliation: { ...broker.reconciliation, expectedHash: hash, observedHash: hash },
            },
            entryDecisionHash: '2'.repeat(64),
            entryIntentIds: [intentId],
            entryFills: [
              {
                schemaVersion: 'bayn.fill.v2' as const,
                accountId: broker.account.accountId,
                fillId: 'entry-fill',
                brokerOrderId: 'crypto-entry',
                clientOrderId: 'native-crypto-entry',
                intentId,
                symbol,
                side: OrderSide.Buy,
                quantityAtoms: '100000000000',
                priceAtoms: '100000000000',
                feeMicros: String(cashFeeMicros),
                occurredAt: at,
              },
            ],
            entryInventoryDebit: { quantityAtoms: '250000000', costBasisMicros: '25000000' },
          },
        }),
      ).payload
      const state = JSON.parse(Result.getOrThrow(makeJevTradingSignalRequest(observation, symbol)).body).state
      const entryFees = 25 + cashFeeMicros / 1_000_000
      expect(state.position.entryFeesUsd).toBe(entryFees)
      expect(state.position.estimatedExitFeesUsd).toBeGreaterThan(25)
      const liquidationCash = (bid: bigint) => {
        const boundary = (bid * 9990n + 9999n) / 10000n
        const proceeds = (boundary * 99_750_000_000n) / 1_000_000_000n
        return proceeds - ((proceeds * 25n + 99_999_999n) / 100_000_000n) * 10_000n
      }
      const observedBid = BigInt(Math.floor(state.candidate.quote.bid * 1_000_000))
      expect(state.position.netLiquidationPnlUsd).toBe(
        Number(liquidationCash(observedBid) - 10_000_000_000n - BigInt(cashFeeMicros)) / 1_000_000,
      )
      expect(state.position.netLiquidationPnlUsd).toBeLessThan(
        state.position.unrealizedPnlAtBidUsd - entryFees - state.position.estimatedExitFeesUsd,
      )
      expect(state.position.remainingHoldingMinutes).toBe(15)
      const breakEvenBid = BigInt(Math.round(state.position.breakEvenExitBidUsd * 1_000_000))
      const acquired = 10_000_000_000n + BigInt(cashFeeMicros)
      expect(liquidationCash(breakEvenBid)).toBeGreaterThanOrEqual(acquired)
      expect(liquidationCash(breakEvenBid - 1n)).toBeLessThan(acquired + 10_000n)
    },
  )
}

test.each([
  { quantity: '500000000', cost: '50000000', value: '51000000', pnl: '1000000', units: 0.5 },
  { quantity: '10000', cost: '1000', value: '1020', pnl: '20', units: 0.00001 },
])('a reconciled partial equity fill retains management: $quantity atoms', ({ quantity, cost, value, pnl, units }) => {
  const fixture = nativeJevFixture(JevPurpose.Manage)
  const portfolio = fixture.portfolio
  if (portfolio.purpose !== JevPurpose.Manage) throw new Error('Management fixture required')
  const fill = portfolio.entryFills[0]
  if (fill === undefined) throw new Error('Entry fill required')
  const material = {
    ...portfolio.brokerState,
    positions: portfolio.brokerState.positions.map((position) => ({
      ...position,
      quantityAtoms: quantity,
      costBasisMicros: cost,
      marketValueMicros: value,
      unrealizedPnlMicros: pnl,
    })),
    orders: portfolio.brokerState.orders.map((order) => ({ ...order, filledQuantityAtoms: quantity })),
  }
  const hash = Result.getOrThrow(reconciledStateHash(material))
  const observation = Result.getOrThrow(
    makeJevObservation({
      ...fixture.input,
      portfolio: {
        ...portfolio,
        brokerState: {
          ...material,
          reconciliation: { ...material.reconciliation, expectedHash: hash, observedHash: hash },
        },
        entryFills: [{ ...fill, quantityAtoms: quantity }],
      },
    }),
  ).payload
  const request = Result.getOrThrow(makeJevTradingSignalRequest(observation, 'AAPL'))
  const state = JSON.parse(request.body).state
  expect(state.position.quantityUnits).toBe(units)
  expect(state.position.estimatedExitFeesUsd).toBeGreaterThan(0)
  expect(state.position.breakEvenExitBidUsd).toBeGreaterThan(100)
  expect(Number.isFinite(state.position.netLiquidationPnlUsd)).toBe(true)
  expect(request.request.questions['action']?.type).toBe('choice')
})

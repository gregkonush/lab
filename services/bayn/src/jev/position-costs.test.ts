import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { OrderSide, OrderStatus, OrderType, TimeInForce } from '../execution/contracts'
import { reconciledStateHash } from '../reconciliation'
import { cryptoMarketFixture } from '../testing/crypto-market-fixture'
import { jevObservationForSnapshot } from './native.test-support'
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
      expect(state.position.netLiquidationPnlUsd).toBeCloseTo(
        state.position.unrealizedPnlAtBidUsd - entryFees - state.position.estimatedExitFeesUsd,
        6,
      )
      expect(state.position.remainingHoldingMinutes).toBe(15)
      const breakEvenBid = BigInt(Math.round(state.position.breakEvenExitBidUsd * 1_000_000))
      const liquidationCash = (bid: bigint) => {
        const proceeds = (bid * 99_750_000_000n) / 1_000_000_000n
        return proceeds - (proceeds * 25n + 9999n) / 10000n
      }
      const acquired = 10_000_000_000n + BigInt(cashFeeMicros)
      expect(liquidationCash(breakEvenBid)).toBeGreaterThanOrEqual(acquired)
      expect(liquidationCash(breakEvenBid - 1n)).toBeLessThan(acquired)
    },
  )
}

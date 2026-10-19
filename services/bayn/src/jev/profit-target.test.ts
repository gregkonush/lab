import { expect, test } from 'bun:test'
import { Result, Schema } from 'effect'
import fc from 'fast-check'

import { quantityScale } from '../quantity'
import { checkProperty } from '../testing/property-test-support'
import { jevLiquidationValue } from './liquidation-economics'
import { nativeJevFixture } from './native.test-support'
import { JevPurpose } from './portfolio'
import { jevPositionProfitTarget, jevProfitTargetBid, jevProfitTargetCrossed } from './profit-target'
import { decideJevEntry, JevEntryTargetSchema } from './decision'
import { nativeJevDecisionEvidence } from './native.test-support'
import { decodeJevProtocol, defaultJevProtocolDocument } from './protocol'

const held = (symbol: string, feeMicros = '0', debitPosted = true) => {
  const fixture = nativeJevFixture(JevPurpose.Manage)
  const original = fixture.portfolio
  if (original.purpose !== JevPurpose.Manage) throw new Error('Expected held position')
  const crypto = symbol.includes('/')
  return {
    ...original,
    entryFills: original.entryFills.map((fill) => ({ ...fill, symbol, feeMicros })),
    entryInventoryDebit: {
      quantityAtoms: crypto && debitPosted ? '12500000' : '0',
      costBasisMicros: crypto && debitPosted ? '1250000' : '0',
    },
    brokerState: {
      ...original.brokerState,
      positions: original.brokerState.positions.map((position) => ({
        ...position,
        symbol,
        quantityAtoms: crypto && debitPosted ? '4987500000' : '5000000000',
      })),
    },
  }
}

for (const symbol of ['AAPL', 'BTC/USD', 'ETH/USD', 'SOL/USD']) {
  test(`${symbol} targets positive net proceeds after fees and the adverse execution allowance`, () => {
    const portfolio = held(symbol)
    const protocol = defaultJevProtocolDocument
    const target = Result.getOrThrow(jevPositionProfitTarget(protocol, portfolio))
    const bid = Result.getOrThrow(jevProfitTargetBid(protocol, portfolio))
    expect(target.profitMicros).toBeGreaterThan(0n)
    expect(Result.getOrThrow(jevProfitTargetCrossed(protocol, portfolio, 100_000_000n))).toBe(false)
    expect(Result.getOrThrow(jevProfitTargetCrossed(protocol, portfolio, bid - 1n))).toBe(false)
    expect(Result.getOrThrow(jevProfitTargetCrossed(protocol, portfolio, bid))).toBe(true)
    const liquidation = Result.getOrThrow(jevLiquidationValue({ protocol, ...target, bidMicros: bid }))
    expect(liquidation.netMicros - target.acquisitionCostMicros).toBeGreaterThanOrEqual(target.profitMicros)
  })
}

test.each(['BTC/USD', 'ETH/USD', 'SOL/USD'])(
  '%s reserves unposted coin fees and does not double count posted debits',
  (symbol) => {
    const protocol = defaultJevProtocolDocument
    const before = Result.getOrThrow(jevPositionProfitTarget(protocol, held(symbol, '0', false)))
    const after = Result.getOrThrow(jevPositionProfitTarget(protocol, held(symbol)))
    expect(before).toEqual(after)
    expect(before.quantityAtoms).toBe(4_987_500_000n)
    expect(before.acquisitionCostMicros).toBe(500_000_000n)
  },
)

test('reported cash fees raise the target instead of turning a gross gain into a profit exit', () => {
  const protocol = defaultJevProtocolDocument
  const portfolio = held('AAPL', '1000000')
  const target = Result.getOrThrow(jevPositionProfitTarget(protocol, portfolio))
  expect(target.acquisitionCostMicros).toBe(502_000_000n)
  expect(Result.getOrThrow(jevProfitTargetBid(protocol, portfolio))).toBeGreaterThan(
    Result.getOrThrow(jevProfitTargetBid(protocol, held('AAPL'))),
  )
})

test('the entry target seals the exit policy and rejects a rehashed policy substitution', () => {
  const entry = Result.getOrThrow(decideJevEntry(nativeJevDecisionEvidence()))
  expect(entry.exitPolicy).toEqual({
    schemaVersion: 'bayn.position-exit-policy.v1',
    maximumPriceCheckIntervalMs: 5000,
    protectiveStopBps: 50,
    profitTargetNetBps: 100,
    maximumHoldingMinutes: 15,
  })
  expect(
    Result.isFailure(
      Schema.decodeUnknownResult(JevEntryTargetSchema)({
        ...entry,
        exitPolicy: { ...entry.exitPolicy, profitTargetNetBps: 1 },
      }),
    ),
  ).toBe(true)
  expect(Result.isFailure(decodeJevProtocol({ ...defaultJevProtocolDocument, minimumExitProbability: 0.65 }))).toBe(
    true,
  )
  expect(
    Result.isFailure(decodeJevProtocol({ ...defaultJevProtocolDocument, schemaVersion: 'bayn.jev.protocol.v12' })),
  ).toBe(true)
})

test('property: positive targets preserve their net margin across fee steps and position sizes', () => {
  const base = held('BTC/USD')
  const first = base.entryFills[0]
  if (first === undefined) throw new Error('Expected an entry fill')
  checkProperty(
    'native-profit-target',
    fc.property(
      fc.bigInt({ min: quantityScale, max: 1000n * quantityScale }),
      fc.integer({ min: 1, max: 500 }),
      (quantity, profitBps) => {
        const debit = (quantity * 25n + 9999n) / 10000n
        const received = quantity - debit
        const protocol = { ...defaultJevProtocolDocument, profitTargetNetBps: profitBps }
        const portfolio = {
          ...base,
          exitPolicy: { ...base.exitPolicy, profitTargetNetBps: profitBps },
          entryInventoryDebit: { quantityAtoms: String(debit), costBasisMicros: String(debit / 10n) },
          entryFills: [
            {
              ...first,
              quantityAtoms: String(quantity),
              symbol: 'BTC/USD',
              feeMicros: '0',
              priceAtoms: '100000000000',
            },
          ],
          brokerState: {
            ...base.brokerState,
            positions: base.brokerState.positions.map((position) => ({ ...position, quantityAtoms: String(received) })),
          },
        }
        const target = Result.getOrThrow(jevPositionProfitTarget(protocol, portfolio))
        const bid = Result.getOrThrow(jevProfitTargetBid(protocol, portfolio))
        for (const delta of [0n, 1n, 999n, 10_000n]) {
          const liquidation = Result.getOrThrow(jevLiquidationValue({ protocol, ...target, bidMicros: bid + delta }))
          expect(liquidation.netMicros - target.acquisitionCostMicros).toBeGreaterThanOrEqual(target.profitMicros)
        }
      },
    ),
  )
})

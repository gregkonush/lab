import assert from 'node:assert/strict'

import { describe, expect, test } from 'bun:test'
import { Result } from 'effect'

import { prepareAccounting } from '../accounting/domain'
import type { AccountingTransaction } from '../accounting/schema'
import { OrderSide } from '../execution/contracts'
import { canonicalHashV1 } from '../hash'
import {
  decodeForwardPerformanceReceiptEnvelopeResult,
  makeForwardPerformanceReceiptEnvelope,
} from '../db/forward-performance-receipt'
import { makeForwardPerformanceReport } from './report'
import type { ForwardPerformanceEvidenceInput } from './model'
import type { ForwardInferenceExpenseSession } from './inference-expenses'
import { coinActivity, coinRoundTrip } from './coin-fee-episodes.test-support'
import { measurePositionEpisodes, PositionEpisodeReason } from './position-episodes'

const success = <A, E>(result: Result.Result<A, E>): A => {
  assert(Result.isSuccess(result))
  return result.success
}

const transaction = (index: number, side: OrderSide, quantity: number, symbol = 'NVDA'): AccountingTransaction => {
  const quantityAtoms = BigInt(quantity) * 1_000_000n
  return success(
    prepareAccounting(
      canonicalHashV1({ index, side, quantity, symbol }),
      {
        schemaVersion: 'bayn.fill.v2',
        accountId: 'episode-account',
        fillId: `fill-${index}`,
        brokerOrderId: `order-${index}`,
        clientOrderId: `client-${index}`,
        symbol,
        side,
        quantityAtoms: quantityAtoms.toString(),
        priceAtoms: '100000000000',
        feeMicros: '100',
        occurredAt: `2026-09-18T15:30:${String(index).padStart(2, '0')}.000Z`,
      },
      side === OrderSide.Buy
        ? { quantityAtoms: '0', costMicros: '0' }
        : {
            quantityAtoms: quantityAtoms.toString(),
            costMicros: (quantityAtoms * 100n).toString(),
          },
      7_001,
    ),
  ).transaction
}

const evidence = (
  history: readonly AccountingTransaction[],
  selected: readonly AccountingTransaction[] = history,
  overrides: Partial<ForwardPerformanceEvidenceInput> = {},
): ForwardPerformanceEvidenceInput => ({
  runtime: {
    sourceRevision: 'a'.repeat(40),
    imageRepository: 'registry.example.test/bayn',
    imageDigest: `sha256:${'b'.repeat(64)}`,
  },
  account: {
    accountId: 'episode-account',
    accountReferenceHash: 'c'.repeat(64),
    provider: 'alpaca',
    environment: 'sandbox',
  },
  durableExecutionBindings: [],
  cycles: [],
  reconciliation: {
    reconciliationId: 'd'.repeat(64),
    contentHash: 'e'.repeat(64),
    status: 'EXACT',
    performanceExact: true,
    cashYieldAdjustedExact: false,
    reconciledAt: '2026-09-18T21:00:00.000Z',
  },
  accountTransactions: history,
  transactions: selected.map((item) => ({ ...item, cycleId: 'f'.repeat(64) })),
  accountingReceiptsExact: true,
  ledgerExact: true,
  missingLedgerAccountCount: 0,
  cashYieldEvidenceRequired: false,
  unresolvedMutationCount: 0,
  unclosedCycleCount: 0,
  openPositionCount: 0,
  ...overrides,
})

const roundTrip = () => [transaction(1, OrderSide.Buy, 2), transaction(2, OrderSide.Sell, 2)]

describe('position episodes', () => {
  test('closes gross fractional buys and net sells using the observed coin debit', () => {
    const { fills, accrual } = coinRoundTrip()
    const input = evidence(fills, fills, { accountFeeAccruals: [accrual], accountBrokerFees: [] })
    expect(success(measurePositionEpisodes(input))).toMatchObject({
      status: 'MEASURED',
      completedCount: 1,
      openCount: 0,
      crossScopeCount: 0,
    })
    const report = success(makeForwardPerformanceReport(input, []))
    expect(report.receipt.counts.completedExecutionCount).toBe(2)
    expect(report.receipt.profitability).toBe('UNDETERMINED')
    expect(report.operatingCostCoverage).toBe('INCOMPLETE')
  })

  test('counts fractional re-entry, an open net holding and inherited inventory', () => {
    const first = coinRoundTrip()
    const second = coinRoundTrip(3)
    const history = [...first.fills, ...second.fills]
    const input = evidence(history, history, {
      accountFeeAccruals: [first.accrual, second.accrual],
      accountBrokerFees: [],
    })
    const result = success(measurePositionEpisodes(input))
    expect(result).toMatchObject({ status: 'MEASURED', completedCount: 2, openCount: 0, crossScopeCount: 0 })
    expect(
      success(
        measurePositionEpisodes({
          ...input,
          accountTransactions: history.toReversed(),
          transactions: input.transactions.toReversed(),
          accountFeeAccruals: [second.accrual, first.accrual],
        }),
      ),
    ).toEqual(result)
    expect(
      success(
        measurePositionEpisodes(
          evidence(first.fills.slice(0, 1), first.fills.slice(0, 1), {
            accountFeeAccruals: [first.accrual],
            accountBrokerFees: [],
            openPositionCount: 1,
          }),
        ),
      ),
    ).toMatchObject({ status: 'MEASURED', completedCount: 0, openCount: 1 })
    expect(
      success(
        measurePositionEpisodes(
          evidence(first.fills, first.fills.slice(1), {
            accountFeeAccruals: [first.accrual],
            accountBrokerFees: [],
          }),
        ),
      ),
    ).toMatchObject({ status: 'MEASURED', completedCount: 0, crossScopeCount: 1 })
  })

  test.each(['0', '40000', '82625'])(
    'counts an accrued debit once with %s atoms receipted and preserves financial uncertainty',
    (matched) => {
      const { fills, accrual } = coinRoundTrip()
      const fee = coinActivity(matched === '0' ? '82625' : matched)
      const settled = matched === '82625'
      const input = evidence(fills, fills, {
        startingCapitalMicros: '100000000',
        accountFeeAccruals: [{ ...accrual, matched_coin_quantity_atoms: matched }],
        accountBrokerFees: matched === '0' ? [] : [fee],
        brokerFeeAccruals: [
          {
            accrualId: accrual.accrual_id,
            accountId: accrual.data.accountId,
            expenseMicros: accrual.expense_micros,
            settled,
          },
        ],
        brokerFees: matched === '0' ? [] : [{ ...fee.data, inventoryCostMicros: '0' }],
        ledgerTotals: {
          realizedGainMicros: '0',
          realizedLossMicros: '0',
          brokerExecutionFeesMicros: '8262',
          otherChargedCostsMicros: '0',
          cashYieldMicros: '0',
        },
      })
      const report = success(makeForwardPerformanceReport(input, []))
      expect(report.positionEpisodes).toMatchObject({ status: 'MEASURED', completedCount: 1, openCount: 0 })
      expect(report.receipt.totals.grossRealizedPnlMicros).toBe('0')
      expect(report.receipt.totals.brokerExecutionFeesMicros).toBe('8262')
      expect(report.receipt.totals.netRealizedPnlAfterCostsMicros).toBe('-8262')
      expect(report.receipt.evidence.reasonCodes).not.toContain('LEDGER_MISMATCH')
      expect(report.receipt.evidence.reasonCodes.includes('BROKER_FEE_SETTLEMENT_PENDING')).toBe(!settled)
      expect(report.receipt.profitability).toBe('UNDETERMINED')
    },
  )

  test('keeps missing fee history, an absent debit and unplaced fee receipts undetermined', () => {
    const { fills, accrual } = coinRoundTrip()
    for (const overrides of [{}, { accountFeeAccruals: [accrual] }, { accountBrokerFees: [] }])
      expect(success(measurePositionEpisodes(evidence(fills, fills, overrides)))).toMatchObject({
        status: 'UNDETERMINED',
        reason: PositionEpisodeReason.FeeHistoryUnavailable,
      })
    expect(
      success(
        measurePositionEpisodes(
          evidence(fills, fills, {
            accountFeeAccruals: [],
            accountBrokerFees: [],
          }),
        ),
      ),
    ).toMatchObject({ status: 'UNDETERMINED', reason: PositionEpisodeReason.ReconciliationGap })
    expect(
      success(
        measurePositionEpisodes(
          evidence(fills, fills, {
            accountFeeAccruals: [],
            accountBrokerFees: [coinActivity()],
          }),
        ),
      ),
    ).toMatchObject({ status: 'UNDETERMINED', reason: PositionEpisodeReason.AmbiguousFeeOrder })
  })

  test('keeps pooled partial fee receipts separate from individual episode boundaries', () => {
    const first = coinRoundTrip()
    const second = coinRoundTrip(3)
    const fills = [...first.fills, ...second.fills]
    expect(
      success(
        measurePositionEpisodes(
          evidence(fills, fills, {
            accountFeeAccruals: [{ ...first.accrual, matched_coin_quantity_atoms: '82625' }, second.accrual],
            accountBrokerFees: [coinActivity()],
          }),
        ),
      ),
    ).toMatchObject({ status: 'MEASURED', completedCount: 2, openCount: 0 })
  })

  test('rejects a coin debit bound to a previous gross-flat episode', () => {
    const first = coinRoundTrip()
    const second = coinRoundTrip(3)
    const firstFill = first.fills[0]
    const secondSell = second.fills[1]
    assert(firstFill !== undefined && secondSell !== undefined)
    const fills = [
      firstFill,
      {
        ...secondSell,
        transactionId: 'a'.repeat(64),
        brokerEventId: 'b'.repeat(64),
        quantityAtoms: firstFill.quantityAtoms,
        quantityDeltaAtoms: `-${firstFill.quantityAtoms}`,
        occurredAt: '2026-09-18T15:30:03.000Z',
      },
      ...second.fills,
    ]
    expect(
      success(
        measurePositionEpisodes(
          evidence(fills, fills, {
            accountFeeAccruals: [
              { ...first.accrual, data: { ...first.accrual.data, observedAt: '2026-09-18T15:30:05.000Z' } },
            ],
            accountBrokerFees: [],
          }),
        ),
      ),
    ).toMatchObject({ status: 'UNDETERMINED', reason: PositionEpisodeReason.InvalidHistory })
  })

  test('rejects duplicate, foreign, future, unposted and unbound coin accruals', () => {
    const { fills, accrual } = coinRoundTrip()
    assert(accrual.data.kind === 'COIN')
    const data = accrual.data
    const source = data.sourceTrades[0]
    assert(source !== undefined)
    const histories = [
      [accrual, accrual],
      [{ ...accrual, posted: false }],
      [{ ...accrual, coin_quantity_atoms: '82624' }],
      [{ ...accrual, matched_coin_quantity_atoms: '82626' }],
      [{ ...accrual, data: { ...data, accountId: 'another-account' } }],
      [{ ...accrual, data: { ...data, observedAt: '2026-09-19T00:00:00.000Z' } }],
      [{ ...accrual, data: { ...data, observedAt: '2026-09-18T15:30:00.000Z' } }],
      [{ ...accrual, data: { ...data, projectedQuantityAtoms: '33050001', observedQuantityAtoms: '32967376' } }],
      [{ ...accrual, data: { ...data, sourceTrades: [] } }],
      [{ ...accrual, data: { ...data, sourceTrades: [{ ...source, transactionId: 'a'.repeat(64) }] } }],
      [{ ...accrual, data: { ...data, sourceTrades: [{ ...source, quantityAtoms: '1' }] } }],
      [{ ...accrual, data: { ...data, sourceTrades: [{ ...source, priceAtoms: '1' }] } }],
      [{ ...accrual, data: { ...data, sourceTrades: [source, source] } }],
    ]
    for (const accountFeeAccruals of histories)
      expect(
        success(
          measurePositionEpisodes(
            evidence(fills, fills, {
              accountFeeAccruals,
              accountBrokerFees: [],
            }),
          ),
        ),
      ).toMatchObject({ status: 'UNDETERMINED', reason: PositionEpisodeReason.InvalidHistory })
  })

  test('does not order a same-instant fee against a fill', () => {
    const { fills, accrual } = coinRoundTrip()
    const simultaneous = { ...accrual, data: { ...accrual.data, observedAt: '2026-09-18T15:30:03.000Z' } }
    expect(
      success(
        measurePositionEpisodes(
          evidence(fills, fills, {
            accountFeeAccruals: [simultaneous],
            accountBrokerFees: [],
          }),
        ),
      ),
    ).toMatchObject({ status: 'UNDETERMINED', reason: PositionEpisodeReason.AmbiguousFeeOrder })
  })

  test('rejects duplicate receipts, unavailable matches and unmatched excess without double counting', () => {
    const { fills, accrual } = coinRoundTrip()
    const fee = coinActivity()
    for (const accountBrokerFees of [
      [],
      [fee, fee],
      [{ ...fee, posted: false }],
      [{ ...fee, data: { ...fee.data, accountId: 'another-account' } }],
      [{ ...fee, read_evidence: { ...fee.read_evidence, observedAt: '2026-09-19T00:00:00.000Z' } }],
    ])
      expect(
        success(
          measurePositionEpisodes(
            evidence(fills, fills, {
              accountFeeAccruals: [{ ...accrual, matched_coin_quantity_atoms: '82625' }],
              accountBrokerFees,
            }),
          ),
        ),
      ).toMatchObject({ status: 'UNDETERMINED', reason: PositionEpisodeReason.InvalidHistory })
    expect(
      success(
        measurePositionEpisodes(
          evidence(fills, fills, {
            accountFeeAccruals: [{ ...accrual, matched_coin_quantity_atoms: '40000' }],
            accountBrokerFees: [fee],
          }),
        ),
      ),
    ).toMatchObject({ status: 'UNDETERMINED', reason: PositionEpisodeReason.AmbiguousFeeOrder })
  })

  test('hashes complete fee provenance independently of selected-scope financial evidence', () => {
    const { fills, accrual } = coinRoundTrip()
    const input = evidence(fills, fills, { accountFeeAccruals: [accrual], accountBrokerFees: [] })
    const report = success(makeForwardPerformanceReport(input, []))
    const changed = success(
      makeForwardPerformanceReport(
        {
          ...input,
          accountFeeAccruals: [{ ...accrual, content_hash: 'b'.repeat(64) }],
        },
        [],
      ),
    )
    expect(changed.receipt).toEqual(report.receipt)
    expect(changed.positionEpisodes.evidenceHash).not.toBe(report.positionEpisodes.evidenceHash)
    expect(changed.reportHash).not.toBe(report.reportHash)
  })

  test('counts a scaled-in position with partial exits as one episode', () => {
    const history = [
      transaction(1, OrderSide.Buy, 2),
      transaction(2, OrderSide.Buy, 3),
      transaction(3, OrderSide.Sell, 1),
      transaction(4, OrderSide.Sell, 4),
    ]
    const result = success(measurePositionEpisodes(evidence(history)))
    expect(result).toMatchObject({ status: 'MEASURED', completedCount: 1, openCount: 0, crossScopeCount: 0 })
    const report = success(makeForwardPerformanceReport(evidence(history), []))
    expect(report.receipt.counts.completedExecutionCount).toBe(4)
    expect(report.positionEpisodes).toEqual(result)
  })

  test('counts re-entry and interleaved symbols separately from open inventory', () => {
    const history = [
      transaction(1, OrderSide.Buy, 2),
      transaction(2, OrderSide.Buy, 3, 'AAPL'),
      transaction(3, OrderSide.Sell, 2),
      transaction(4, OrderSide.Buy, 1),
      transaction(5, OrderSide.Sell, 1),
      transaction(6, OrderSide.Sell, 2, 'AAPL'),
    ]
    expect(success(measurePositionEpisodes(evidence(history, history, { openPositionCount: 1 })))).toMatchObject({
      status: 'MEASURED',
      completedCount: 2,
      openCount: 1,
      crossScopeCount: 0,
    })
  })

  test('excludes inherited inventory from completed round trips in the selected scope', () => {
    const history = [
      transaction(1, OrderSide.Buy, 2),
      transaction(2, OrderSide.Buy, 1),
      transaction(3, OrderSide.Sell, 3),
    ]
    expect(success(measurePositionEpisodes(evidence(history, history.slice(1))))).toMatchObject({
      status: 'MEASURED',
      completedCount: 0,
      openCount: 0,
      crossScopeCount: 1,
    })
  })

  test('counts only the selected complete episodes from the cumulative history', () => {
    const history = [...roundTrip(), transaction(3, OrderSide.Buy, 1), transaction(4, OrderSide.Sell, 1)]
    const selected = history.slice(2)
    const first = success(measurePositionEpisodes(evidence(history, selected)))
    const reordered = success(measurePositionEpisodes(evidence(history.toReversed(), selected.toReversed())))
    expect(first).toEqual(reordered)
    expect(first).toMatchObject({ status: 'MEASURED', completedCount: 1 })
  })

  test('reports verified zero trades without turning absent history into zero', () => {
    expect(success(measurePositionEpisodes(evidence([])))).toMatchObject({ status: 'MEASURED', completedCount: 0 })
    const { accountTransactions: _history, ...input } = evidence([])
    expect(success(measurePositionEpisodes(input))).toMatchObject({
      status: 'UNDETERMINED',
      reason: PositionEpisodeReason.HistoryUnavailable,
    })
  })

  test('rejects a missing opening fill even when the selected sell has a receipt', () => {
    const history = [transaction(2, OrderSide.Sell, 2)]
    expect(success(measurePositionEpisodes(evidence(history)))).toMatchObject({
      status: 'UNDETERMINED',
      reason: PositionEpisodeReason.InvalidHistory,
    })
  })

  test('does not invent buy/sell ordering within one millisecond', () => {
    const [buy, sell] = roundTrip()
    assert(buy !== undefined && sell !== undefined)
    const history = [buy, { ...sell, occurredAt: buy.occurredAt }]
    expect(success(measurePositionEpisodes(evidence(history)))).toMatchObject({
      status: 'UNDETERMINED',
      reason: PositionEpisodeReason.AmbiguousFillOrder,
    })
  })

  test.each(['duplicate', 'account', 'delta', 'future'] as const)('rejects %s account history', (fault) => {
    const [buy, sell] = roundTrip()
    assert(buy !== undefined && sell !== undefined)
    const history =
      fault === 'duplicate'
        ? [buy, buy, sell]
        : [
            buy,
            {
              ...sell,
              ...(fault === 'account' ? { accountId: 'another-account' } : {}),
              ...(fault === 'delta' ? { quantityDeltaAtoms: '2000000000' } : {}),
              ...(fault === 'future' ? { occurredAt: '2026-09-19T15:30:02.000Z' } : {}),
            },
          ]
    expect(success(measurePositionEpisodes(evidence(history)))).toMatchObject({
      status: 'UNDETERMINED',
      reason: PositionEpisodeReason.InvalidHistory,
    })
  })

  test('rejects a missing, duplicate or mismatched selected transaction', () => {
    const history = roundTrip()
    const [buy] = history
    assert(buy !== undefined)
    for (const selected of [[buy, buy], [{ ...buy, symbol: 'AAPL' }], [transaction(3, OrderSide.Buy, 1)]]) {
      expect(success(measurePositionEpisodes(evidence(history, selected)))).toMatchObject({
        status: 'UNDETERMINED',
        reason: PositionEpisodeReason.ScopeMismatch,
      })
    }
  })

  test.each([
    { ledgerExact: false },
    { accountingReceiptsExact: false },
    { unresolvedMutationCount: 1 },
    { missingLedgerAccountCount: 1 },
    { openPositionCount: 1 },
  ])('withholds measurement for reconciliation gaps %j', (override) => {
    const history = roundTrip()
    expect(success(measurePositionEpisodes(evidence(history, history, override)))).toMatchObject({
      status: 'UNDETERMINED',
      reason: PositionEpisodeReason.ReconciliationGap,
    })
  })

  test('binds the declared inference expense snapshot timestamp in the report hash', () => {
    const expense: ForwardInferenceExpenseSession = {
      sessionDate: '2026-09-18',
      authorityGenerationHash: 'a'.repeat(64),
      sourceAsOf: '2026-09-18T21:01:00.000Z',
      knownEstimatedCostPicoUsd: '420000',
      claimedRequestCount: 1,
      missingQuoteCount: 0,
      unverifiedRequestCount: 0,
      gapRequestCount: 0,
      completeMeteredCoverage: true,
      exactSessionLedger: true,
      invoiceReconciled: false,
    }
    const report = success(makeForwardPerformanceReport(evidence(roundTrip()), [expense]))
    const { reportHash, ...material } = report
    expect(canonicalHashV1(material)).toBe(reportHash)
    expect(
      canonicalHashV1({
        ...material,
        inferenceExpenses: [{ ...expense, sourceAsOf: '2026-09-18T21:02:00.000Z' }],
      }),
    ).not.toBe(reportHash)
  })

  test('keeps the strict v3 stored receipt unchanged and binds episodes in a separate versioned report', () => {
    const report = success(makeForwardPerformanceReport(evidence(roundTrip()), []))
    const { receipt, reportHash, ...reportFields } = report
    expect(report.schemaVersion).toBe('bayn.forward-performance-report.v2')
    expect(receipt.schemaVersion).toBe('bayn.forward-performance-receipt.v3')
    expect(receipt).not.toHaveProperty('positionEpisodes')
    expect(canonicalHashV1({ ...reportFields, receipt })).toBe(reportHash)
    expect(
      canonicalHashV1({
        ...reportFields,
        receipt,
        positionEpisodes: { ...report.positionEpisodes, completedCount: 99 },
      }),
    ).not.toBe(reportHash)
    const envelope = success(
      makeForwardPerformanceReceiptEnvelope({
        schemaVersion: 'bayn.forward-performance-receipt-envelope.v1',
        authorityGenerationHash: 'a'.repeat(64),
        cycleId: 'b'.repeat(64),
        receiptHash: receipt.receiptHash,
        receipt,
        createdAt: '2026-09-18T21:01:00.000Z',
      }),
    )
    expect(success(decodeForwardPerformanceReceiptEnvelopeResult(envelope))).toEqual(envelope)
    const { receiptHash: _, ...receiptMaterial } = receipt
    const changedMaterial = { ...receiptMaterial, positionEpisodes: report.positionEpisodes }
    const changedReceipt = { ...changedMaterial, receiptHash: canonicalHashV1(changedMaterial) }
    const { contentHash: _contentHash, ...envelopeMaterial } = envelope
    const changedEnvelope = { ...envelopeMaterial, receiptHash: changedReceipt.receiptHash, receipt: changedReceipt }
    expect(
      Result.isFailure(
        decodeForwardPerformanceReceiptEnvelopeResult({
          ...changedEnvelope,
          contentHash: canonicalHashV1(changedEnvelope),
        }),
      ),
    ).toBe(true)
  })
})

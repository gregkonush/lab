import { expect, test } from 'bun:test'
import { Result } from 'effect'
import { prepareFeeAccrual } from '../accounting/fee-accrual'
import { hashLedgerPlanResult } from '../ledger-plan'
import { feeAccrualCohortSettled, type StoredAccrual } from './fee-accruals'

const accrual = (kind: 'COIN' | 'CASH', cycle: string, amount: number, matched: number): typeof StoredAccrual.Type => {
  const common = {
    schemaVersion: 'bayn.broker-fee-accrual.v1',
    accountId: 'cohort-paper',
    cycleId: cycle.repeat(64),
    date: '2026-10-14',
    observedAt: '2026-10-14T22:00:00.000Z',
    sourceTrades: [{ transactionId: cycle.repeat(64), quantityAtoms: '1000000000', priceAtoms: '100000000000' }],
  }
  const data =
    kind === 'COIN'
      ? {
          ...common,
          kind,
          symbol: 'ETH/USD',
          positionSnapshotId: 'a'.repeat(64),
          projectedQuantityAtoms: '1000000000',
          observedQuantityAtoms: String(1000000000 - amount),
          projectedCostMicros: '100000000',
          observedCostMicros: String(100000000 - amount / 10),
        }
      : {
          ...common,
          kind,
          symbol: 'USD',
          accountEventId: 'a'.repeat(64),
          projectedCashMicros: '100000000',
          observedCashMicros: String(100000000 - amount),
          cashReportingQuantumMicros: '1',
        }
  const prepared = Result.getOrThrow(prepareFeeAccrual(data, 7001))
  return {
    accrual_id: prepared.accrualId,
    data: prepared.data,
    content_hash: prepared.contentHash,
    coin_quantity_atoms: prepared.coinQuantityAtoms,
    cash_debit_micros: prepared.cashDebitMicros,
    expense_micros: prepared.expenseMicros,
    matched_coin_quantity_atoms: kind === 'COIN' ? String(matched) : '0',
    matched_cash_micros: kind === 'CASH' ? String(matched) : '0',
    ledger_plan_hash: Result.getOrThrow(hashLedgerPlanResult(prepared.plan)),
    tigerbeetle_cluster_id: '2001',
    tigerbeetle_ledger: 7001,
    posted: true,
  }
}

test.each(['COIN', 'CASH'] as const)(
  '%s partial pooled receipt cannot qualify a different originating cycle',
  (kind) => {
    const a = accrual(kind, 'b', 100, 100)
    const partialB = accrual(kind, 'c', 200, 100)
    expect(feeAccrualCohortSettled(a, [a, partialB])).toBe(false)
    expect(feeAccrualCohortSettled(partialB, [a, partialB])).toBe(false)
    const completeB = accrual(kind, 'c', 200, 200)
    expect(feeAccrualCohortSettled(a, [a, completeB])).toBe(true)
    expect(feeAccrualCohortSettled(completeB, [a, completeB])).toBe(true)
    expect(feeAccrualCohortSettled(a, [a, { ...completeB, posted: false }])).toBe(false)
    expect(feeAccrualCohortSettled(a, [a, { ...partialB, data: { ...partialB.data, accountId: 'other-paper' } }])).toBe(
      true,
    )
  },
)

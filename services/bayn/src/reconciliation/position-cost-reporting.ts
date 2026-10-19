import type { FeeAccrual } from '../accounting/fee-accrual'
import type { AccountingTransaction } from '../accounting/schema'
import { OrderSide } from '../execution/contracts'
import type { ProjectedPosition } from '../reconciliation'

export const positionCostAnchor = (
  accountId: string,
  position: Omit<ProjectedPosition, 'costBasisAnchor'>,
  transactions: readonly AccountingTransaction[],
  accruals: readonly FeeAccrual[],
): ProjectedPosition['costBasisAnchor'] => {
  const anchor = accruals
    .filter((a) => a.kind === 'COIN' && a.accountId === accountId && a.symbol === position.symbol)
    .toSorted((a, b) => b.observedAt.localeCompare(a.observedAt))[0]
  if (anchor?.kind !== 'COIN') return null
  const sourceIds = new Set(anchor.sourceTrades.map((t) => t.transactionId))
  const sources = transactions.filter((t) => sourceIds.has(t.transactionId))
  if (
    sources.length !== sourceIds.size ||
    sources.some(
      (t) =>
        t.accountId !== accountId ||
        t.symbol !== position.symbol ||
        t.side !== OrderSide.Buy ||
        t.occurredAt > anchor.observedAt ||
        !anchor.sourceTrades.some(
          (s) =>
            s.transactionId === t.transactionId && s.quantityAtoms === t.quantityAtoms && s.priceAtoms === t.priceAtoms,
        ),
    ) ||
    sources.reduce((sum, t) => sum + BigInt(t.quantityAtoms), 0n).toString() !== anchor.projectedQuantityAtoms ||
    sources.reduce((sum, t) => sum + BigInt(t.costBasisDeltaMicros), 0n).toString() !== anchor.projectedCostMicros
  )
    return null
  const sourceQuantity = BigInt(anchor.projectedQuantityAtoms)
  const sourceNotional = sources.reduce((sum, t) => sum + BigInt(t.quantityAtoms) * BigInt(t.priceAtoms), 0n)
  const divisor = sourceQuantity * 1_000_000_000_000n
  const averageAtoms = (sourceNotional * 2n + sourceQuantity) / (sourceQuantity * 2n)
  const weightedCost = (sourceNotional * BigInt(anchor.observedQuantityAtoms) * 2n + divisor) / (divisor * 2n)
  const reportedAverageCost =
    (averageAtoms * BigInt(anchor.observedQuantityAtoms) + 500_000_000_000n) / 1_000_000_000_000n
  if (weightedCost !== BigInt(anchor.observedCostMicros) && reportedAverageCost !== BigInt(anchor.observedCostMicros))
    return null
  const firstSourceAt = sources.reduce((first, t) => (t.occurredAt < first ? t.occurredAt : first), anchor.observedAt)
  const subsequent = transactions.filter(
    (t) =>
      t.accountId === accountId &&
      t.symbol === position.symbol &&
      t.occurredAt >= firstSourceAt &&
      !sourceIds.has(t.transactionId),
  )
  if (subsequent.some((t) => t.side !== OrderSide.Sell || t.occurredAt < anchor.observedAt)) return null
  const quantity =
    BigInt(anchor.observedQuantityAtoms) - subsequent.reduce((sum, t) => sum + BigInt(t.quantityAtoms), 0n)
  const nativeCost =
    BigInt(anchor.observedCostMicros) + subsequent.reduce((sum, t) => sum + BigInt(t.costBasisDeltaMicros), 0n)
  if (
    quantity <= 0n ||
    nativeCost < 0n ||
    quantity.toString() !== position.quantityAtoms ||
    nativeCost.toString() !== position.costBasisMicros
  )
    return null
  return { quantityAtoms: anchor.projectedQuantityAtoms, notionalAtomProduct: sourceNotional.toString() }
}

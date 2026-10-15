import { Data, Result, Schema } from 'effect'
import { canonicalHashV1Result } from '../hash'
import { brokerFeeLedgerPlan, coinFeeLedgerPlan } from './domain'
import {
  IsoDateSchema,
  Sha256Schema,
  StrictNonEmptyStringSchema,
  SymbolSchema,
  UtcInstantSchema,
  strictParseOptions,
} from '../schemas'
import { PositiveMicrosSchema, SignedMicrosSchema, UnsignedMicrosSchema } from '../execution/contracts'
import {
  CashReportingQuantumSchema,
  maximumCashReportingQuantumMicros,
  reportedCashMicros,
} from '../broker/alpaca/cash-reporting'

const SourceTrade = Schema.Struct({
  transactionId: Sha256Schema,
  quantityAtoms: PositiveMicrosSchema,
  priceAtoms: PositiveMicrosSchema,
})
const Common = {
  schemaVersion: Schema.Literal('bayn.broker-fee-accrual.v1'),
  accountId: StrictNonEmptyStringSchema,
  date: IsoDateSchema,
  cycleId: Sha256Schema,
  observedAt: UtcInstantSchema,
  sourceTrades: Schema.Array(SourceTrade).check(Schema.isMinLength(1)),
}
export const FeeAccrualSchema = Schema.Union([
  Schema.Struct({
    ...Common,
    kind: Schema.Literal('COIN'),
    symbol: SymbolSchema,
    positionSnapshotId: Sha256Schema,
    projectedQuantityAtoms: PositiveMicrosSchema,
    observedQuantityAtoms: PositiveMicrosSchema,
    projectedCostMicros: UnsignedMicrosSchema,
    observedCostMicros: UnsignedMicrosSchema,
  }),
  Schema.Struct({
    ...Common,
    kind: Schema.Literal('CASH'),
    symbol: Schema.Literal('USD'),
    accountEventId: Sha256Schema,
    projectedCashMicros: SignedMicrosSchema,
    observedCashMicros: SignedMicrosSchema,
    cashReportingQuantumMicros: CashReportingQuantumSchema,
  }),
])
export type FeeAccrual = typeof FeeAccrualSchema.Type
export class FeeAccrualError extends Data.TaggedError('FeeAccrualError')<{ readonly message: string }> {}
const invalid = (message: string) => Result.fail(new FeeAccrualError({ message }))

export const prepareFeeAccrual = (input: unknown, ledger: number) =>
  Result.gen(function* () {
    const data = yield* Schema.decodeUnknownResult(
      FeeAccrualSchema,
      strictParseOptions,
    )(input).pipe(Result.mapError(() => new FeeAccrualError({ message: 'Fee accrual evidence is malformed' })))
    const ids = data.sourceTrades.map((trade) => trade.transactionId)
    if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && id <= (ids[index - 1] ?? '')))
      return yield* invalid('Fee accrual requires unique ordered native trades')
    let coinQuantityAtoms: string | null = null
    let cashDebitMicros: string | null = null
    let expense: bigint
    if (data.kind === 'COIN') {
      if (!['BTC/USD', 'ETH/USD', 'SOL/USD'].includes(data.symbol))
        return yield* invalid('Only native USD crypto can accrue coin fees')
      const quantity = BigInt(data.projectedQuantityAtoms) - BigInt(data.observedQuantityAtoms)
      expense = BigInt(data.projectedCostMicros) - BigInt(data.observedCostMicros)
      const bought = data.sourceTrades.reduce((sum, trade) => sum + BigInt(trade.quantityAtoms), 0n)
      // The bound admits a debit observed in holdings; it does not estimate the fee.
      if (
        quantity <= 0n ||
        quantity > (bought * 25n + 9999n) / 10000n + BigInt(data.sourceTrades.length - 1) ||
        expense < 0n
      )
        return yield* invalid('Observed coin debit exceeds the verified buy fee bound')
      const prices = data.sourceTrades.map((trade) => BigInt(trade.priceAtoms))
      const minimum = prices.reduce((a, b) => (a < b ? a : b))
      const maximum = prices.reduce((a, b) => (a > b ? a : b))
      const rounding = BigInt(data.sourceTrades.length + 1)
      if (
        expense + rounding < (quantity * minimum) / 1_000_000_000_000n ||
        expense > (quantity * maximum + 999_999_999_999n) / 1_000_000_000_000n + rounding
      )
        return yield* invalid('Observed coin cost debit does not agree with the source buy prices')
      coinQuantityAtoms = quantity.toString()
    } else {
      if (BigInt(data.projectedCashMicros) < 0n || BigInt(data.observedCashMicros) < 0n)
        return yield* invalid('Cash fee accrual cannot authorize a negative cash balance')
      expense =
        BigInt(reportedCashMicros(data.projectedCashMicros, data.cashReportingQuantumMicros)) -
        BigInt(data.observedCashMicros)
      const soldNotional = data.sourceTrades.reduce(
        (sum, trade) => sum + BigInt(trade.quantityAtoms) * BigInt(trade.priceAtoms),
        0n,
      )
      const maximum =
        (soldNotional * 25n + 9_999_999_999_999_999n) / 10_000_000_000_000_000n +
        BigInt(data.cashReportingQuantumMicros) * BigInt(data.sourceTrades.length) +
        // The opening report may have used the provider's coarsest precision, independently of this report.
        BigInt(maximumCashReportingQuantumMicros)
      if (
        expense <= 0n ||
        expense > maximum ||
        BigInt(data.observedCashMicros) % BigInt(data.cashReportingQuantumMicros) !== 0n
      )
        return yield* invalid('Observed cash debit exceeds the verified sell fee and reporting bound')
      cashDebitMicros = expense.toString()
    }
    const identity = {
      schemaVersion: 'bayn.broker-fee-accrual-id.v1',
      accountId: data.accountId,
      kind: data.kind,
      symbol: data.symbol,
      cycleId: data.cycleId,
      sourceTradeTransactionIds: ids,
      coinQuantityAtoms,
      cashDebitMicros,
      expenseMicros: expense.toString(),
    }
    const accrualId = yield* canonicalHashV1Result(identity).pipe(
      Result.mapError(() => new FeeAccrualError({ message: 'Fee accrual identity cannot be hashed' })),
    )
    const contentHash = yield* canonicalHashV1Result(data).pipe(
      Result.mapError(() => new FeeAccrualError({ message: 'Fee accrual evidence cannot be hashed' })),
    )
    const plan =
      data.kind === 'COIN'
        ? coinFeeLedgerPlan(data.accountId, accrualId, data.symbol, expense.toString(), ledger)
        : brokerFeeLedgerPlan(data.accountId, accrualId, (-expense).toString(), ledger)
    return { data, accrualId, contentHash, coinQuantityAtoms, cashDebitMicros, expenseMicros: expense.toString(), plan }
  })

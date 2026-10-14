import { PgClient } from '@effect/sql-pg'
import { Effect, Result, Schema } from 'effect'

import { brokerFeeLedgerPlan, coinFeeLedgerPlan } from '../accounting/domain'
import type { FeeActivity } from '../broker/alpaca'
import { canonicalHashV1Result } from '../hash'
import { hashLedgerPlanResult } from '../ledger-plan'
import type { JournalService } from '../ledger'
import type { LedgerPlan } from '../ledger-plan'
import { strictParseOptions } from '../schemas'
import {
  brokerFeePredatesOpeningCash,
  BrokerFeeSchema,
  FeeReadEvidenceSchema,
  StoredFeeSchema,
  verifyBrokerFeeRecord,
} from '../accounting/broker-fees'
import type { Observed } from '../simulation-reconciliation/broker-reconciler-model'
import { ReconciliationStoreError } from './reconciliation'

const invariant = (message: string, cause?: unknown) =>
  new ReconciliationStoreError({
    operation: 'reconcile',
    failure: 'invariant',
    message,
    ...(cause === undefined ? {} : { cause }),
  })
const fromResult = <A, E>(result: Result.Result<A, E>) =>
  Effect.fromResult(result).pipe(Effect.mapError((cause) => invariant('broker fee evidence is invalid', cause)))

export interface BrokerFeeAccounting {
  readonly fees: readonly FeeActivity[]
  readonly plans: readonly LedgerPlan[]
}

/** Called inside the account writer fence and reconciliation transaction. */
export const accountBrokerFees = (
  sql: PgClient.PgClient,
  journal: JournalService,
  accountId: string,
  observed: readonly Observed<FeeActivity>[],
  identity: { readonly clusterId: bigint; readonly ledger: number },
): Effect.Effect<BrokerFeeAccounting, ReconciliationStoreError> =>
  Effect.gen(function* () {
    const openingRows =
      observed.length === 0
        ? []
        : yield* sql<Record<string, unknown>>`
      SELECT to_char(event.observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS observed_at
      FROM account_snapshots AS snapshot JOIN broker_events AS event ON event.event_id = snapshot.event_id
      WHERE snapshot.account_id = ${accountId}
        AND event.account_id = snapshot.account_id
        AND event.event_kind = 'ACCOUNT'
      ORDER BY event.source_sequence LIMIT 1
    `
    const openings = yield* fromResult(
      Schema.decodeUnknownResult(
        Schema.Array(Schema.Struct({ observed_at: FeeReadEvidenceSchema.fields.observedAt })),
        strictParseOptions,
      )(openingRows),
    )
    const opening = openings[0]
    if (observed.length > 0 && opening === undefined)
      return yield* invariant('broker fee accounting requires an opening cash baseline')
    if (opening !== undefined && observed.some(({ value }) => brokerFeePredatesOpeningCash(value, opening.observed_at)))
      return yield* invariant(
        'broker fee history predates the opening cash baseline; earlier baseline evidence is required',
      )
    const rows = yield* sql<Record<string, unknown>>`
    SELECT data, coin_cost_basis_micros::text AS coin_cost_basis_micros, read_evidence, content_hash, ledger_plan_hash, tigerbeetle_cluster_id::text AS tigerbeetle_cluster_id,
      tigerbeetle_ledger::integer AS tigerbeetle_ledger, posted_at IS NOT NULL AS posted
    FROM broker_fee_accounting WHERE account_id = ${accountId} ORDER BY activity_id COLLATE "C"
  `
    const stored = yield* fromResult(
      Schema.decodeUnknownResult(Schema.Array(StoredFeeSchema), strictParseOptions)(rows),
    )
    const byId = new Map(stored.map((row) => [row.data.activityId, row]))
    const seen = new Set<string>()
    const fees: FeeActivity[] = []
    const plans: LedgerPlan[] = []
    const coinAdjustments = new Map<string, { quantity: bigint; cost: bigint }>()
    const prepared = yield* Effect.forEach(
      [...observed].sort((a, b) => a.value.activityId.localeCompare(b.value.activityId)),
      (observation) =>
        Effect.gen(function* () {
          const readEvidence = yield* fromResult(
            Schema.decodeUnknownResult(FeeReadEvidenceSchema)({
              requestId: observation.evidence.requestId,
              status: observation.evidence.status,
              contentHash: observation.evidence.contentHash,
              observedAt: observation.evidence.observedAt,
            }),
          )
          const fee = yield* fromResult(
            Schema.decodeUnknownResult(BrokerFeeSchema, strictParseOptions)(observation.value),
          )
          if (
            fee.accountId !== accountId ||
            seen.has(fee.activityId) ||
            fee.date > observation.evidence.observedAt.slice(0, 10)
          )
            return yield* invariant('broker fee account, uniqueness, or date binding is invalid')
          seen.add(fee.activityId)
          const contentHash = yield* fromResult(canonicalHashV1Result({ schemaVersion: 'bayn.broker-fee.v1', ...fee }))
          const existing = byId.get(fee.activityId)
          let coinCostBasisMicros: string | null = existing?.coin_cost_basis_micros ?? null
          if (fee.coinDebit !== undefined && existing === undefined) {
            if (fee.netAmountMicros !== '0') return yield* invariant('coin fee cannot change cash')
            const coin = fee.coinDebit
            const balances = yield* sql<Record<string, unknown>>`
              SELECT
                COALESCE((SELECT sum(quantity_delta_atoms) FROM accounting_transactions WHERE account_id = ${accountId} AND symbol = ${coin.symbol}), 0)::text AS quantity,
                COALESCE((SELECT sum(cost_basis_delta_micros) FROM accounting_transactions WHERE account_id = ${accountId} AND symbol = ${coin.symbol}), 0)::text AS cost,
                COALESCE((SELECT sum((data->'coinDebit'->>'quantityAtoms')::numeric) FROM broker_fee_accounting WHERE account_id = ${accountId} AND data->'coinDebit'->>'symbol' = ${coin.symbol}), 0)::text AS deducted_quantity,
                COALESCE((SELECT sum(coin_cost_basis_micros) FROM broker_fee_accounting WHERE account_id = ${accountId} AND data->'coinDebit'->>'symbol' = ${coin.symbol}), 0)::text AS deducted_cost
            `
            const [balance] = yield* fromResult(
              Schema.decodeUnknownResult(
                Schema.Tuple([
                  Schema.Struct({
                    quantity: Schema.String,
                    cost: Schema.String,
                    deducted_quantity: Schema.String,
                    deducted_cost: Schema.String,
                  }),
                ]),
                strictParseOptions,
              )(balances),
            )
            const adjustment = coinAdjustments.get(coin.symbol) ?? { quantity: 0n, cost: 0n }
            const quantity = BigInt(balance.quantity) - BigInt(balance.deducted_quantity) - adjustment.quantity
            const cost = BigInt(balance.cost) - BigInt(balance.deducted_cost) - adjustment.cost
            const debit = BigInt(coin.quantityAtoms)
            if (quantity < debit || cost < 0n) return yield* invariant('coin fee exceeds accounted inventory')
            const removed = debit === quantity ? cost : (cost * debit + quantity / 2n) / quantity
            coinCostBasisMicros = removed.toString()
            coinAdjustments.set(coin.symbol, { quantity: adjustment.quantity + debit, cost: adjustment.cost + removed })
          }
          const plan =
            fee.coinDebit === undefined
              ? brokerFeeLedgerPlan(accountId, fee.activityId, fee.netAmountMicros, identity.ledger)
              : coinFeeLedgerPlan(
                  accountId,
                  fee.activityId,
                  fee.coinDebit.symbol,
                  coinCostBasisMicros ?? '0',
                  identity.ledger,
                )
          const planHash = yield* fromResult(hashLedgerPlanResult(plan))
          if (existing !== undefined) {
            yield* fromResult(verifyBrokerFeeRecord(existing, accountId, identity))
            if (existing.content_hash !== contentHash)
              return yield* invariant('durable broker fee changed its economic content')
          }
          return { fee, coinCostBasisMicros, readEvidence, plan, planHash, contentHash, existing }
        }),
    )
    if (stored.some((row) => !seen.has(row.data.activityId)))
      return yield* invariant('broker fee history omitted previously accounted activity')
    for (const { fee, coinCostBasisMicros, readEvidence, plan, planHash, contentHash, existing } of prepared) {
      if (existing === undefined) {
        yield* sql`
        INSERT INTO broker_fee_accounting(account_id,activity_id,fee_date,net_amount_micros,coin_cost_basis_micros,data,read_evidence,content_hash,
          ledger_plan_hash,tigerbeetle_cluster_id,tigerbeetle_ledger,first_observed_at)
        VALUES(${accountId},${fee.activityId},${fee.date},${fee.netAmountMicros},${coinCostBasisMicros},${sql.json(fee)},${sql.json(readEvidence)},${contentHash},
          ${planHash},${identity.clusterId.toString()},${identity.ledger},${readEvidence.observedAt})
      `
      }
      if (existing?.posted !== true) {
        if (plan.transfers.length > 0)
          yield* journal.post(plan).pipe(
            Effect.mapError(
              (cause) =>
                new ReconciliationStoreError({
                  operation: 'reconcile',
                  failure: 'ledger',
                  message: 'broker fee ledger posting failed',
                  cause,
                }),
            ),
          )
        yield* sql`UPDATE broker_fee_accounting SET posted_at = ${readEvidence.observedAt} WHERE account_id = ${accountId} AND activity_id = ${fee.activityId}`
      }
      fees.push(fee)
      plans.push(plan)
    }
    return { fees, plans }
  }).pipe(
    Effect.mapError((cause) =>
      cause instanceof ReconciliationStoreError
        ? cause
        : new ReconciliationStoreError({
            operation: 'reconcile',
            failure: 'query',
            message: 'broker fee persistence failed',
            cause,
          }),
    ),
  )

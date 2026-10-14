import { PgClient } from '@effect/sql-pg'
import { Effect, Layer, Result, Schema } from 'effect'

import {
  BrokerObservations,
  decodeObservedBrokerSnapshot,
  observedBrokerSnapshotHash,
  observationUnavailable,
  validateObservedBrokerSnapshot,
  type BrokerObservationTicket,
  type ObservedBrokerSnapshot,
} from '../broker/alpaca/observed-snapshot'
import { BrokerReadError, BrokerReadErrorKind } from '../broker/alpaca/failures'
import { mutationConsistencyDelayMs } from '../broker/alpaca/model'
import { currentUtcInstant } from '../time'
import { UtcInstantSchema, strictParseOptions } from '../schemas'

export enum BrokerObservationClaimStatus {
  Reserved = 'RESERVED',
  QuotaWait = 'QUOTA_WAIT',
  AlreadyClaimed = 'ALREADY_CLAIMED',
}
export type BrokerObservationClaim =
  | {
      readonly status: BrokerObservationClaimStatus.Reserved
      readonly ticket: BrokerObservationTicket
      readonly nextPollNotBeforeMs: number
    }
  | {
      readonly status: BrokerObservationClaimStatus.QuotaWait | BrokerObservationClaimStatus.AlreadyClaimed
      readonly nextPollNotBeforeMs: number
    }
const quotaDeadline = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
)
const claimRows = Schema.Array(
  Schema.Union([
    Schema.Struct({
      status: Schema.Literal(BrokerObservationClaimStatus.Reserved),
      generation: Schema.Int.check(Schema.isGreaterThan(0)),
      startedAt: UtcInstantSchema,
      nextPollNotBeforeMs: quotaDeadline,
    }),
    Schema.Struct({
      status: Schema.Union([
        Schema.Literal(BrokerObservationClaimStatus.QuotaWait),
        Schema.Literal(BrokerObservationClaimStatus.AlreadyClaimed),
      ]),
      generation: Schema.Null,
      startedAt: Schema.Null,
      nextPollNotBeforeMs: quotaDeadline,
    }),
  ]),
).check(Schema.isMaxLength(1))

export const makeBrokerObservationStore = (
  sql: PgClient.PgClient,
  accountId: string,
  sourceRevision: string,
  maximumAgeMs: number,
) => {
  const decodeProjectionRows = Schema.decodeUnknownEffect(
    Schema.Array(Schema.Struct({ payload: Schema.Unknown, snapshot_hash: Schema.String })),
    strictParseOptions,
  )
  const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, BrokerReadError, R> =>
    effect.pipe(
      Effect.mapError((cause) =>
        cause instanceof BrokerReadError
          ? cause
          : observationUnavailable('Broker observation persistence failed', cause),
      ),
    )
  const activate = (nextPollNotBeforeMs: number) =>
    run(
      sql`
    INSERT INTO broker_observations (account_id, source_revision, next_poll_not_before)
    VALUES (${accountId}, ${sourceRevision}, to_timestamp(${nextPollNotBeforeMs}::double precision / 1000.0))
    ON CONFLICT (account_id) DO UPDATE SET source_revision = EXCLUDED.source_revision,
      generation = broker_observations.generation + 1, available = false,
      poll_started_at = NULL, observed_at = NULL, completed_at = NULL, snapshot_hash = NULL, payload = NULL,
      next_poll_not_before = GREATEST(broker_observations.next_poll_not_before,
          to_timestamp(${nextPollNotBeforeMs}::double precision / 1000.0))
  `.pipe(Effect.asVoid),
    )
  const invalidate = run(
    sql`
    UPDATE broker_observations SET generation = generation + 1, available = false
    WHERE account_id = ${accountId}
  `.pipe(Effect.asVoid),
  )
  const recoverUnfinished = (captureId: string) =>
    run(
      sql`
    WITH owner AS (
      SELECT account_id, generation FROM broker_observations
      WHERE account_id = ${accountId} AND source_revision = ${sourceRevision}
      FOR UPDATE
    ), unfinished AS (
      SELECT capture.generation FROM broker_observation_captures AS capture
      JOIN owner ON owner.account_id = capture.account_id AND owner.generation = capture.generation
      WHERE capture.capture_id = ${captureId} AND NOT capture.settled
      FOR UPDATE OF capture
    )
    UPDATE broker_observations SET generation = generation + 1, available = false
    WHERE account_id = ${accountId} AND source_revision = ${sourceRevision}
      AND generation IN (SELECT generation FROM unfinished)
  `.pipe(Effect.asVoid),
    )
  const begin = (
    captureId: string,
    interruptedNotBeforeMs: number,
  ): Effect.Effect<BrokerObservationClaim, BrokerReadError> =>
    run(
      sql`
    WITH owner AS (
      SELECT account_id, generation, next_poll_not_before, clock_timestamp() AS checked_at FROM broker_observations
      WHERE account_id = ${accountId} AND source_revision = ${sourceRevision}
      FOR UPDATE
    ), claimed AS (
      INSERT INTO broker_observation_captures (account_id, capture_id, generation)
      SELECT account_id, ${captureId}, generation + 1 FROM owner
      WHERE next_poll_not_before <= checked_at
      ON CONFLICT DO NOTHING
      RETURNING account_id, generation
    ), reserved AS (
    UPDATE broker_observations SET generation = claimed.generation, quota_generation = claimed.generation,
      next_poll_not_before = GREATEST(broker_observations.next_poll_not_before,
        to_timestamp(${interruptedNotBeforeMs}::double precision / 1000.0))
    FROM claimed WHERE broker_observations.account_id = claimed.account_id
    RETURNING broker_observations.generation,
      to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startedAt",
      (EXTRACT(EPOCH FROM broker_observations.next_poll_not_before) * 1000)::double precision AS "nextPollNotBeforeMs"
    )
    SELECT 'RESERVED' AS status, generation, "startedAt", "nextPollNotBeforeMs" FROM reserved
    UNION ALL
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM broker_observation_captures WHERE account_id = owner.account_id AND capture_id = ${captureId}
    ) THEN 'ALREADY_CLAIMED' ELSE 'QUOTA_WAIT' END AS status,
      NULL::integer AS generation, NULL::text AS "startedAt",
      (EXTRACT(EPOCH FROM next_poll_not_before) * 1000)::double precision AS "nextPollNotBeforeMs"
    FROM owner WHERE NOT EXISTS (SELECT 1 FROM reserved)
  `.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(claimRows, strictParseOptions)),
        Effect.flatMap((rows) =>
          Effect.gen(function* () {
            const row = rows[0]
            if (row === undefined)
              return yield* observationUnavailable('Broker observation owner is not active for this revision')
            if (row.status === BrokerObservationClaimStatus.Reserved)
              return {
                status: row.status,
                ticket: { generation: row.generation, startedAt: row.startedAt },
                nextPollNotBeforeMs: row.nextPollNotBeforeMs,
              }
            if (row.status === BrokerObservationClaimStatus.AlreadyClaimed) yield* recoverUnfinished(captureId)
            return { status: row.status, nextPollNotBeforeMs: row.nextPollNotBeforeMs }
          }),
        ),
      ),
    )
  const publish = (ticket: BrokerObservationTicket, value: ObservedBrokerSnapshot, nextPollNotBeforeMs: number) =>
    run(
      Effect.gen(function* () {
        const decoded = decodeObservedBrokerSnapshot(value)
        if (Result.isFailure(decoded))
          return yield* observationUnavailable(
            'Broker observation cannot be published because decoding failed',
            decoded.failure,
          )
        yield* validateObservedBrokerSnapshot(value, accountId, yield* currentUtcInstant, maximumAgeMs)
        if (value.startedAt !== ticket.startedAt)
          return yield* observationUnavailable('Broker poll start does not match its durable ticket')
        const rows = yield* sql`
      WITH published AS (
      UPDATE broker_observations SET available = true, poll_started_at = ${value.startedAt}::timestamptz,
        observed_at = ${value.observedAt}::timestamptz, completed_at = ${value.completedAt}::timestamptz,
        snapshot_hash = ${observedBrokerSnapshotHash(value)}, payload = ${sql.json(value)},
        next_poll_not_before = to_timestamp(${nextPollNotBeforeMs}::double precision / 1000.0)
      WHERE account_id = ${accountId} AND source_revision = ${sourceRevision} AND generation = ${ticket.generation}
        AND (poll_started_at IS NULL OR poll_started_at <= ${ticket.startedAt}::timestamptz)
        AND NOT EXISTS (
          SELECT 1 FROM mutation_events AS mutation JOIN intents AS intent USING (intent_id)
          WHERE intent.account_id = ${accountId}
            AND mutation.occurred_at + ${mutationConsistencyDelayMs} * interval '1 millisecond' >= ${ticket.startedAt}::timestamptz
        )
        AND NOT EXISTS (SELECT 1 FROM broker_events WHERE account_id = ${accountId}
          AND observed_at > ${ticket.startedAt}::timestamptz)
      RETURNING account_id
      )
      UPDATE broker_observation_captures SET settled = true
      WHERE account_id = ${accountId} AND generation = ${ticket.generation}
        AND EXISTS (SELECT 1 FROM published)
      RETURNING account_id
    `
        return rows.length === 1
      }),
    )
  const failed = (ticket: BrokerObservationTicket, nextPollNotBeforeMs: number) =>
    run(
      sql`
    WITH failed AS (
    UPDATE broker_observations SET
      available = CASE WHEN generation = ${ticket.generation} THEN false ELSE available END,
      poll_started_at = CASE WHEN generation = ${ticket.generation} THEN ${ticket.startedAt}::timestamptz ELSE poll_started_at END,
      completed_at = CASE WHEN generation = ${ticket.generation} THEN NULL ELSE completed_at END,
      next_poll_not_before = to_timestamp(${nextPollNotBeforeMs}::double precision / 1000.0)
    WHERE account_id = ${accountId} AND source_revision = ${sourceRevision} AND quota_generation = ${ticket.generation}
    RETURNING account_id
    )
    UPDATE broker_observation_captures SET settled = true
    WHERE account_id = ${accountId} AND generation = ${ticket.generation}
  `.pipe(Effect.asVoid),
    )
  const readProjection = (intentId: string | null) =>
    run(
      Effect.gen(function* () {
        const rows = yield* sql`
      SELECT payload, snapshot_hash FROM broker_observations
      WHERE account_id = ${accountId} AND source_revision = ${sourceRevision} AND available
        AND NOT EXISTS (
          SELECT 1 FROM mutation_events AS mutation JOIN intents AS intent USING (intent_id)
          WHERE intent.account_id = ${accountId} AND mutation.occurred_at >= poll_started_at
            AND NOT (${intentId}::text IS NOT NULL AND mutation.intent_id = ${intentId}
              AND mutation.event_type = 'SUBMIT_STARTED')
        )
        AND NOT EXISTS (SELECT 1 FROM broker_events WHERE account_id = ${accountId}
          AND observed_at > completed_at)
        AND (${intentId}::text IS NULL OR NOT EXISTS (
          SELECT 1 FROM (
            SELECT DISTINCT ON (mutation.mutation_id) mutation.intent_id, mutation.event_type, mutation.operation, intent.state
            FROM mutation_events AS mutation JOIN intents AS intent USING (intent_id)
            WHERE intent.account_id = ${accountId}
            ORDER BY mutation.mutation_id, mutation.sequence DESC
          ) AS latest WHERE latest.state <> 'TERMINAL' AND (
            latest.event_type IN ('SUBMIT_STARTED', 'SUBMIT_UNKNOWN', 'RECOVERY_NOT_FOUND', 'RECOVERY_UNKNOWN',
              'CANCEL_STARTED', 'CANCEL_ACCEPTED', 'CANCEL_UNKNOWN')
            OR (latest.operation = 'CANCEL' AND latest.event_type = 'RECOVERY_FOUND')
          ) AND NOT (latest.intent_id = ${intentId} AND latest.event_type = 'SUBMIT_STARTED')
        ))
        AND (${intentId}::text IS NULL OR EXISTS (
          SELECT 1 FROM intents AS reserved
          WHERE reserved.intent_id = ${intentId} AND reserved.account_id = ${accountId} AND reserved.state = 'IO_STARTED'
            AND EXISTS (SELECT 1 FROM mutation_events WHERE intent_id = reserved.intent_id
              AND event_type = 'SUBMIT_STARTED')
        ))
    `.pipe(Effect.flatMap(decodeProjectionRows))
        let row = rows[0]
        const pending = row === undefined
        if (pending) {
          const now = yield* currentUtcInstant
          const awaiting = yield* sql`
        SELECT payload, snapshot_hash FROM broker_observations
        WHERE account_id = ${accountId} AND source_revision = ${sourceRevision}
          AND observed_at > ${now}::timestamptz - ${maximumAgeMs} * interval '1 millisecond'
          AND completed_at <= ${now}::timestamptz AND completed_at >= poll_started_at
          AND (
            EXISTS (SELECT 1 FROM mutation_events AS mutation JOIN intents AS intent USING (intent_id)
              WHERE intent.account_id = ${accountId} AND mutation.occurred_at >= poll_started_at)
            OR EXISTS (SELECT 1 FROM broker_events WHERE account_id = ${accountId} AND observed_at > completed_at)
          )
      `.pipe(Effect.flatMap(decodeProjectionRows))
          row = awaiting[0]
        }
        if (row === undefined)
          return yield* observationUnavailable('Broker observation is unavailable or invalidated by a mutation')
        const decoded = decodeObservedBrokerSnapshot(row.payload)
        if (Result.isFailure(decoded))
          return yield* observationUnavailable('Persisted broker observation failed decoding', decoded.failure)
        if (observedBrokerSnapshotHash(decoded.success) !== row.snapshot_hash)
          return yield* observationUnavailable('Persisted broker observation content hash changed')
        const validated = yield* validateObservedBrokerSnapshot(
          decoded.success,
          accountId,
          yield* currentUtcInstant,
          maximumAgeMs,
        )
        if (pending)
          return yield* new BrokerReadError({
            operation: 'preflight',
            kind: BrokerReadErrorKind.ObservationPending,
            retryable: true,
            message: 'Broker observation is awaiting a fresh post-mutation cut',
          })
        return validated
      }),
    )
  return { activate, begin, publish, failed, invalidate, read: readProjection(null), readForSubmit: readProjection }
}

export const BrokerObservationsLive = (accountId: string, sourceRevision: string, maximumAgeMs: number) =>
  Layer.effect(
    BrokerObservations,
    Effect.map(PgClient.PgClient, (sql) => makeBrokerObservationStore(sql, accountId, sourceRevision, maximumAgeMs)),
  )

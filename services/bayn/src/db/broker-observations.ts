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
  const activate = run(
    sql`
    INSERT INTO broker_observations (account_id, source_revision)
    VALUES (${accountId}, ${sourceRevision})
    ON CONFLICT (account_id) DO UPDATE SET source_revision = EXCLUDED.source_revision,
      generation = broker_observations.generation + 1, available = false,
      poll_started_at = NULL, observed_at = NULL, completed_at = NULL, snapshot_hash = NULL, payload = NULL
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
  const begin = (captureId: string) =>
    run(
      sql`
    WITH owner AS (
      SELECT account_id, generation FROM broker_observations
      WHERE account_id = ${accountId} AND source_revision = ${sourceRevision}
      FOR UPDATE
    ), claimed AS (
      INSERT INTO broker_observation_captures (account_id, capture_id, generation)
      SELECT account_id, ${captureId}, generation + 1 FROM owner
      ON CONFLICT DO NOTHING
      RETURNING account_id, generation
    )
    UPDATE broker_observations SET generation = claimed.generation
    FROM claimed WHERE broker_observations.account_id = claimed.account_id
    RETURNING broker_observations.generation,
      to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "startedAt"
  `.pipe(
        Effect.flatMap(
          Schema.decodeUnknownEffect(
            Schema.Array(
              Schema.Struct({
                generation: Schema.Int.check(Schema.isGreaterThan(0)),
                startedAt: UtcInstantSchema,
              }),
            ).check(Schema.isMaxLength(1)),
            strictParseOptions,
          ),
        ),
        Effect.flatMap((rows) =>
          rows[0] === undefined ? Effect.as(recoverUnfinished(captureId), undefined) : Effect.succeed(rows[0]),
        ),
      ),
    )
  const publish = (ticket: BrokerObservationTicket, value: ObservedBrokerSnapshot) =>
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
        snapshot_hash = ${observedBrokerSnapshotHash(value)}, payload = ${sql.json(value)}
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
  const failed = (ticket: BrokerObservationTicket) =>
    run(
      sql`
    WITH failed AS (
    UPDATE broker_observations SET available = false, poll_started_at = ${ticket.startedAt}::timestamptz,
      completed_at = NULL
    WHERE account_id = ${accountId} AND source_revision = ${sourceRevision} AND generation = ${ticket.generation}
      AND (poll_started_at IS NULL OR poll_started_at <= ${ticket.startedAt}::timestamptz)
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

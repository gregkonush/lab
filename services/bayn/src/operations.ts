import { Effect } from 'effect'
import { isSqlError } from 'effect/sql/SqlError'

import { CycleObservabilityError } from './cycle/store/observability'
import { DatabaseError } from './db/database-error'
import { operationalError, retryableOperationalError, type Component, type OperationalError } from './errors'
import { Pipeable } from './pipeable'

type DatabaseOperationFailure = DatabaseError | CycleObservabilityError

const withinDeadlineDataFirst = <A, R>(
  effect: Effect.Effect<A, OperationalError, R>,
  timeoutMs: number,
  component: Component,
  operation: string,
): Effect.Effect<A, OperationalError, R> =>
  effect.pipe(
    Effect.timeoutOrElse({
      duration: timeoutMs,
      orElse: () =>
        Effect.fail(
          retryableOperationalError({
            component,
            operation,
            message: `${operation} timed out after ${timeoutMs}ms`,
          }),
        ),
    }),
  )

export const withinDeadline = Pipeable.generic<
  <A, R>(
    timeoutMs: number,
    component: Component,
    operation: string,
  ) => (effect: Effect.Effect<A, OperationalError, R>) => Effect.Effect<A, OperationalError, R>,
  typeof withinDeadlineDataFirst
>(4, withinDeadlineDataFirst)

const databaseOperationDataFirst = <A, R>(
  effect: Effect.Effect<A, DatabaseOperationFailure, R>,
  operation: string,
): Effect.Effect<A, OperationalError, R> =>
  effect.pipe(
    Effect.mapError((cause) => {
      const retryable =
        cause instanceof DatabaseError
          ? cause.failure === 'unavailable' && (!isSqlError(cause.cause) || cause.cause.isRetryable)
          : cause.failure === 'query' && isSqlError(cause.cause) && cause.cause.isRetryable
      const makeError = retryable ? retryableOperationalError : operationalError
      return makeError({ component: 'database', operation, message: `PostgreSQL ${operation} failed`, cause })
    }),
  )

export const databaseOperation = Pipeable.generic<
  <A, R>(
    operation: string,
  ) => (effect: Effect.Effect<A, DatabaseOperationFailure, R>) => Effect.Effect<A, OperationalError, R>,
  typeof databaseOperationDataFirst
>(2, databaseOperationDataFirst)

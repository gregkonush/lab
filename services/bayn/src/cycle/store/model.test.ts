import { expect, test } from 'bun:test'
import { Effect, Result } from 'effect'
import { ConstraintError, SqlError } from 'effect/sql/SqlError'

import { runCycleStore, type CycleStoreError } from './model'

test.each([
  {
    operation: 'bind-decision',
    code: '23514',
    constraint: 'autonomous_cycles_entry_admission_deadline',
    failure: 'entry-expired',
  },
  { operation: 'bind-decision', code: '23514', constraint: 'another_constraint', failure: 'conflict' },
  {
    operation: 'bind-decision',
    code: '23503',
    constraint: 'autonomous_cycles_entry_admission_deadline',
    failure: 'conflict',
  },
  { operation: 'finish', code: '23514', constraint: 'autonomous_cycles_entry_admission_deadline', failure: 'conflict' },
] as const)(
  'classifies $operation / $code / $constraint as $failure',
  async ({ operation, code, constraint, failure }) => {
    const cause = new SqlError({
      reason: new ConstraintError({
        cause: Object.assign(new Error('PostgreSQL rejected a write'), { code, constraint }),
      }),
    })
    const result = await Effect.runPromise(runCycleStore(operation, Effect.fail(cause)).pipe(Effect.result))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isSuccess(result)) throw new Error('Expected a durable write rejection')
    expect(result.failure).toMatchObject({
      operation,
      failure,
      persistenceFailure: 'constraint',
    } satisfies Partial<CycleStoreError>)
    expect(result.failure.cause).toBe(cause)
  },
)

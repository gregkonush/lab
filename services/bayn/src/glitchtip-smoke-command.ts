import * as Sentry from '@sentry/node'
import { NodeRuntime } from '@effect/platform-node'
import { Effect } from 'effect'
import { CycleRunnerError } from './cycle/runner'
import { flushErrorTracking, initializeErrorTracking } from './error-tracking'
import { OperationalError } from './errors'
import { observePass } from './observe-composition/decision-builder'
import { currentUtcInstant } from './time'

/** Manual deployment smoke only; not invoked by a trading process. */
if (!initializeErrorTracking(process.env['BAYN_ERROR_TRACKING_SERVICE'] || 'bayn-smoke')) {
  throw new Error('GlitchTip smoke cannot run without a configured DSN')
}
Sentry.setTag('synthetic', 'true')
NodeRuntime.runMain(
  Effect.gen(function* () {
    yield* observePass(() => Effect.void, {
      outcome: 'FAILED',
      observedAt: yield* currentUtcInstant,
      error: new CycleRunnerError({
        operation: 'run-cycle-pass',
        failure: 'operational',
        message: 'GlitchTip synthetic handled cycle pass smoke',
      }),
    })
    if (!(yield* Effect.promise(() => flushErrorTracking(5_000)))) {
      return yield* new OperationalError({
        component: 'http',
        operation: 'glitchtip-smoke',
        retryable: false,
        message: 'GlitchTip synthetic integration event did not flush',
      })
    }
    yield* Effect.logInfo('Synthetic failed cycle pass was sent by the Sentry SDK')
  }),
)

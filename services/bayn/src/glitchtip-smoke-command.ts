import * as Sentry from '@sentry/node'
import { flushErrorTracking, initializeErrorTracking } from './error-tracking'

/** Manual deployment smoke only; not invoked by a trading process. */
if (!initializeErrorTracking(process.env['BAYN_ERROR_TRACKING_SERVICE'] || 'bayn-smoke')) {
  throw new Error('GlitchTip smoke cannot run without a configured DSN')
}
Sentry.captureException(new Error('GlitchTip synthetic integration smoke'))
if (!(await flushErrorTracking(5_000))) {
  throw new Error('GlitchTip synthetic integration event did not flush')
}
console.log('Synthetic exception was sent by the Sentry SDK')

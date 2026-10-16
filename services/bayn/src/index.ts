import { NodeRuntime } from '@effect/platform-node'
import { Effect, pipe } from 'effect'

import { program } from './entrypoint'
import { initializeErrorTracking, reportTerminalFailure } from './error-tracking'
import { makeConfiguredTelemetryRuntimeLayer } from './telemetry'

initializeErrorTracking('bayn')
NodeRuntime.runMain(
  pipe(
    program,
    Effect.annotateLogs({ service: 'bayn' }),
    // @effect-diagnostics-next-line strictEffectProvide:off -- process entry point owns the telemetry layer
    Effect.provide(makeConfiguredTelemetryRuntimeLayer('bayn')),
    reportTerminalFailure('bayn'),
  ),
)

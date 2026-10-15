import * as Sentry from '@sentry/node'
import { trace } from '@opentelemetry/api'
import { Cause, Effect } from 'effect'
import { embeddedBuildMetadata } from './build'

/**
 * Error-only GlitchTip reporting. Existing Effect/OpenTelemetry tracing remains
 * authoritative; the Sentry SDK must not create another tracing pipeline.
 * Neither account data nor broker requests may leave the trading namespace.
 */
let initialized = false

export const sanitizeErrorEvent = (event: Sentry.ErrorEvent): Sentry.ErrorEvent => {
  delete event.user
  delete event.request
  delete event.extra
  delete event.breadcrumbs
  delete event.contexts
  delete event.transaction
  if (event.message !== undefined) event.message = 'Bayn application exception'
  for (const exception of event.exception?.values ?? []) {
    // Preserve the exception class and stack frames for grouping, never the
    // exception message: it may include broker tokens, orders, or raw inputs.
    exception.value = 'Message withheld: potentially sensitive runtime data'
    for (const frame of exception.stacktrace?.frames ?? []) {
      delete frame.vars
      delete frame.context_line
      delete frame.pre_context
      delete frame.post_context
    }
  }
  return event
}

export const initializeErrorTracking = (service: string, env: NodeJS.ProcessEnv = process.env): boolean => {
  const dsn = env['BAYN_GLITCHTIP_DSN']?.trim()
  if (dsn === undefined || dsn.length === 0) return false
  if (initialized) return true
  const endpoint = new URL(dsn)
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
    throw new Error('Bayn GlitchTip DSN must use HTTP(S)')
  if (endpoint.hostname !== 'glitchtip-web.glitchtip.svc.cluster.local') {
    throw new Error('Bayn GlitchTip DSN must use the internal service')
  }
  if (!/^[0-9a-f]{32}$/.test(endpoint.username) || !/^\/[1-9][0-9]*$/.test(endpoint.pathname)) {
    // Django models UUID keys with dashes; Sentry DSNs require a hex public key.
    throw new Error('Bayn GlitchTip DSN has an invalid project key or project ID')
  }
  Sentry.init({
    dsn,
    release: env['BAYN_CODE_REVISION'] || embeddedBuildMetadata?.sourceRevision,
    environment: env['NODE_ENV'] || 'production',
    // Disable SDK auto-instrumentation, request body collection and tracing.
    defaultIntegrations: false,
    tracesSampleRate: 0,
    maxBreadcrumbs: 0,
    beforeSend: sanitizeErrorEvent,
    integrations: [Sentry.onUncaughtExceptionIntegration(), Sentry.onUnhandledRejectionIntegration()],
  })
  if (Sentry.getClient()?.getDsn() === undefined) {
    throw new Error('Bayn GlitchTip SDK did not accept its configured DSN')
  }
  Sentry.setTag('service', service)
  Sentry.setTag('namespace', 'bayn')
  initialized = true
  return true
}

export const reportError = (error: unknown, service: string): void => {
  if (!initialized) return
  Sentry.withScope((scope) => {
    scope.setTag('service', service)
    const traceId = trace.getActiveSpan()?.spanContext().traceId
    if (traceId !== undefined && traceId.length > 0) scope.setTag('trace_id', traceId)
    Sentry.captureException(error)
  })
}

/** Only report a terminal Effect cause. Typed intermediate failures are not issues. */
export const reportTerminalFailure =
  (service: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    effect.pipe(
      Effect.tapCause((cause) =>
        Effect.sync(() => {
          // Normal Kubernetes shutdown interrupts scoped fibers; it is not an
          // application error and must not create a new issue every rollout.
          if (!Cause.hasInterruptsOnly(cause)) reportError(Cause.squash(cause), service)
        }),
      ),
    )

export const flushErrorTracking = (timeoutMs = 3_000): Promise<boolean> =>
  initialized ? Sentry.flush(timeoutMs) : Promise.resolve(true)

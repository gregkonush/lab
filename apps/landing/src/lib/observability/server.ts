import * as Sentry from '@sentry/node'
import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import { W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { glitchTipDsn, sanitizeErrorEvent } from './errors'

let initialized = false
let provider: NodeTracerProvider | undefined

export function initializeObservability() {
  if (initialized) return
  const release = process.env.APP_SOURCE_REVISION || 'development'
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  if (endpoint) {
    provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'service.name': 'tengri-bff',
        'service.namespace': 'tengri',
        'service.version': release,
        'deployment.environment.name': 'production',
      }),
      spanProcessors: [new BatchSpanProcessor(new OTLPTraceExporter({ url: endpoint, timeoutMillis: 3_000 }))],
    })
    provider.register({
      contextManager: new AsyncLocalStorageContextManager(),
      propagator: new W3CTraceContextPropagator(),
    })
  }
  const dsn = glitchTipDsn(process.env.SENTRY_DSN)
  if (dsn)
    Sentry.init({
      dsn: dsn.toString(),
      release,
      environment: 'production',
      defaultIntegrations: false,
      enableOpenTelemetrySetup: false,
      tracesSampleRate: 0,
      maxBreadcrumbs: 0,
      integrations: [Sentry.onUncaughtExceptionIntegration(), Sentry.onUnhandledRejectionIntegration()],
      beforeSend: sanitizeErrorEvent,
    })
  initialized = true
}

export function reportServerError(error: unknown, operation: string, status?: number) {
  Sentry.withScope((scope) => {
    scope.setTag('service', 'tengri-bff')
    scope.setTag('operation', operation)
    if (status !== undefined) scope.setTag('status', status)
    const traceId = trace.getActiveSpan()?.spanContext().traceId
    if (traceId) scope.setTag('trace_id', traceId)
    Sentry.captureException(error)
  })
}

export async function observeRequest(request: Request, operation: string, run: () => Promise<Response>) {
  const parent = propagation.extract(context.active(), request.headers, {
    keys: () => ['traceparent', 'tracestate'],
    get: (headers, key) => headers.get(key) ?? undefined,
  })
  return trace.getTracer('tengri-bff').startActiveSpan(operation, { kind: SpanKind.SERVER }, parent, async (span) => {
    try {
      const response = await run()
      span.setAttribute('http.response.status_code', response.status)
      if (response.status >= 500) span.setStatus({ code: SpanStatusCode.ERROR })
      const headers = new Headers(response.headers)
      const id = span.spanContext().traceId
      if (!/^0+$/.test(id)) headers.set('x-trace-id', id)
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR })
      reportServerError(error, operation)
      throw error
    } finally {
      span.end()
    }
  })
}

export function injectTrace(set: (key: string, value: string) => void) {
  propagation.inject(context.active(), undefined, { set: (_carrier, key, value) => set(key, value) })
}

export async function flushObservability() {
  await Promise.all([provider?.forceFlush(), Sentry.flush(3_000)])
}

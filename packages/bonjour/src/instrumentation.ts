import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

const serviceName = process.env.OTEL_SERVICE_NAME ?? process.env.LGTM_SERVICE_NAME ?? 'bonjour'
const serviceNamespace = process.env.OTEL_SERVICE_NAMESPACE ?? process.env.POD_NAMESPACE ?? 'default'
const serviceInstanceId = process.env.POD_NAME ?? process.pid.toString()

const tracesEndpoint =
  process.env.LGTM_TEMPO_TRACES_ENDPOINT ??
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ??
  'http://lgtm-tempo-gateway.lgtm.svc.cluster.local:4318/v1/traces'
const metricsEndpoint =
  process.env.LGTM_MIMIR_METRICS_ENDPOINT ??
  process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ??
  'http://lgtm-mimir-nginx.lgtm.svc.cluster.local/otlp/v1/metrics'

const exportInterval = parseInt(process.env.OTEL_METRIC_EXPORT_INTERVAL ?? '15000', 10)

const sharedHeaders = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS)
const traceHeaders = {
  ...sharedHeaders,
  ...parseHeaders(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS),
}
const metricHeaders = {
  ...sharedHeaders,
  ...parseHeaders(process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS),
}

const resource = Resource.default().merge(
  new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_NAMESPACE]: serviceNamespace,
    [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: serviceInstanceId,
  }),
)

const metricReader = new PeriodicExportingMetricReader({
  exporter: new OTLPMetricExporter({
    url: metricsEndpoint,
    headers: metricHeaders,
  }),
  exportIntervalMillis: Number.isFinite(exportInterval) ? Math.max(exportInterval, 5000) : 15000,
})

const sdk = new NodeSDK({
  resource,
  traceExporter: new OTLPTraceExporter({
    url: tracesEndpoint,
    headers: traceHeaders,
  }),
  metricReader: metricReader as unknown as never,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        enabled: true,
      },
      '@opentelemetry/instrumentation-undici': {
        enabled: true,
      },
    }),
  ],
})

let shuttingDown = false

let startupResult: unknown
try {
  startupResult = sdk.start() as unknown
} catch (error) {
  diag.error('failed to start OpenTelemetry SDK', error)
}

if (isPromise(startupResult)) {
  startupResult.catch((error) => {
    diag.error('failed to start OpenTelemetry SDK', error)
  })
}

const shutdown = () => {
  if (shuttingDown) {
    return
  }
  shuttingDown = true
  void sdk.shutdown().catch((error) => {
    diag.error('failed to gracefully shutdown OpenTelemetry SDK', error)
  })
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)

function isPromise<T = unknown>(value: unknown): value is Promise<T> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof (value as Promise<T>).then === 'function' &&
    'catch' in value &&
    typeof (value as Promise<T>).catch === 'function'
  )
}

function parseHeaders(value?: string) {
  if (!value) {
    return undefined
  }

  const result: Record<string, string> = {}

  for (const pair of value.split(',')) {
    const [rawKey, ...rawRest] = pair.split('=')
    if (!rawKey || rawRest.length === 0) {
      continue
    }
    const key = rawKey.trim()
    const rawValue = rawRest.join('=').trim()
    if (!key || !rawValue) {
      continue
    }
    result[key] = rawValue
  }

  return Object.keys(result).length > 0 ? result : undefined
}

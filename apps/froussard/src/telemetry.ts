import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { type MetricReader, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { NodeSDK } from '@opentelemetry/sdk-node'
import { Resource } from '@opentelemetry/resources'
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions'

diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR)

const serviceName = process.env.OTEL_SERVICE_NAME ?? process.env.LGTM_SERVICE_NAME ?? 'froussard'
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
const traceHeaders = mergeHeaders(sharedHeaders, parseHeaders(process.env.OTEL_EXPORTER_OTLP_TRACES_HEADERS))
const metricHeaders = mergeHeaders(sharedHeaders, parseHeaders(process.env.OTEL_EXPORTER_OTLP_METRICS_HEADERS))

const resource = Resource.default().merge(
  new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    [SemanticResourceAttributes.SERVICE_NAMESPACE]: serviceNamespace,
    [SemanticResourceAttributes.SERVICE_INSTANCE_ID]: serviceInstanceId,
  }),
)

const metricReader: MetricReader = new PeriodicExportingMetricReader({
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
  metricReader,
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

try {
  Promise.resolve(sdk.start()).catch((error) => {
    diag.error('failed to start OpenTelemetry SDK', error)
  })
} catch (error) {
  diag.error('failed to start OpenTelemetry SDK', error)
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

function mergeHeaders(...headers: Array<Record<string, string> | undefined>): Record<string, string> | undefined {
  const merged: Record<string, string> = {}

  for (const header of headers) {
    if (!header) {
      continue
    }
    Object.assign(merged, header)
  }

  return Object.keys(merged).length > 0 ? merged : undefined
}

export const telemetrySdk = sdk

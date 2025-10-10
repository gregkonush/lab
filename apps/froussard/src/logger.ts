import pino, { multistream } from 'pino'

const level = process.env.LOG_LEVEL ?? 'info'
const service = process.env.OTEL_SERVICE_NAME ?? process.env.LGTM_SERVICE_NAME ?? 'froussard'
const namespace = process.env.OTEL_SERVICE_NAMESPACE ?? process.env.POD_NAMESPACE ?? 'default'
const lokiEndpoint = process.env.LGTM_LOKI_ENDPOINT
const lokiBasicAuth = process.env.LGTM_LOKI_BASIC_AUTH

const destinations: { stream: NodeJS.WritableStream }[] = [{ stream: process.stdout }]

if (lokiEndpoint) {
  try {
    const { host, endpoint } = normaliseLokiEndpoint(lokiEndpoint)

    const lokiStream = pino.transport({
      target: 'pino-loki',
      options: {
        host,
        endpoint,
        batching: true,
        interval: 5,
        timeout: 5000,
        replaceTimestamp: true,
        labels: {
          service,
          namespace,
        },
        basicAuth: lokiBasicAuth,
      },
    })

    destinations.push({ stream: lokiStream })
  } catch (error) {
    // eslint-disable-next-line no-console -- logger initialisation fallback
    console.warn('failed to initialise pino-loki transport', error)
  }
}

export const logger = pino(
  {
    level,
    base: {
      service,
      namespace,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  multistream(destinations),
)

function normaliseLokiEndpoint(value: string): { host: string; endpoint?: string } {
  try {
    const parsed = new URL(value)
    const endpoint = parsed.pathname === '/' ? undefined : parsed.pathname
    return { host: `${parsed.protocol}//${parsed.host}`, endpoint }
  } catch {
    return { host: value }
  }
}

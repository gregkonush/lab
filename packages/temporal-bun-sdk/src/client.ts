import { Buffer } from 'node:buffer'
import { loadTemporalConfig, type TemporalConfig, type TemporalTlsConfig } from './config.js'
import { createRuntime, type RuntimeOptions, TemporalRuntime } from './core-bridge/runtime.js'
import { createNativeClient, type NativeClientConfig, TemporalCoreClient } from './core-bridge/client.js'

const DEFAULT_CLIENT_NAME = 'temporal-bun-sdk'
const DEFAULT_CLIENT_VERSION = (typeof process !== 'undefined' && process.env?.npm_package_version) || '0.1.0'

export interface CreateTemporalClientOptions {
  config?: TemporalConfig
  runtime?: TemporalRuntime
  runtimeOptions?: RuntimeOptions
  clientConfig?: Partial<NativeClientConfig>
}

export interface TemporalClientInstance {
  runtime: TemporalRuntime
  client: TemporalCoreClient
  config: TemporalConfig
  shutdown: () => Promise<void>
}

export const createTemporalClient = async (
  options: CreateTemporalClientOptions = {},
): Promise<TemporalClientInstance> => {
  const config = options.config ?? (await loadTemporalConfig())

  const runtime = options.runtime ?? createRuntime(options.runtimeOptions)
  const ownsRuntime = options.runtime === undefined

  const nativeConfig: NativeClientConfig = {
    address: options.clientConfig?.address ?? config.address,
    namespace: options.clientConfig?.namespace ?? config.namespace,
    identity: options.clientConfig?.identity ?? config.workerIdentity,
    clientName: options.clientConfig?.clientName ?? DEFAULT_CLIENT_NAME,
    clientVersion: options.clientConfig?.clientVersion ?? DEFAULT_CLIENT_VERSION,
    defaultTaskQueue: options.clientConfig?.defaultTaskQueue ?? config.taskQueue,
    apiKey: options.clientConfig?.apiKey ?? config.apiKey,
    tls: options.clientConfig?.tls ?? toClientTlsOptions(config.tls, config.allowInsecureTls),
    allowInsecureTls: options.clientConfig?.allowInsecureTls ?? config.allowInsecureTls,
  }

  const client = await createNativeClient(runtime, nativeConfig)

  const shutdown = async () => {
    await client.shutdown()
    if (ownsRuntime) {
      await runtime.shutdown()
    }
  }

  return { runtime, client, config, shutdown }
}

const toClientTlsOptions = (config?: TemporalTlsConfig, allowInsecure?: boolean) => {
  if (!config && !allowInsecure) return undefined

  const tls: NativeClientConfig['tls'] = {}

  if (config?.serverRootCACertificate) {
    tls.serverRootCACertificate = Buffer.from(config.serverRootCACertificate).toString('base64')
  }

  if (config?.clientCertPair?.crt && config.clientCertPair?.key) {
    tls.clientCert = Buffer.from(config.clientCertPair.crt).toString('base64')
    tls.clientPrivateKey = Buffer.from(config.clientCertPair.key).toString('base64')
  }

  if (config?.serverNameOverride) {
    tls.serverNameOverride = config.serverNameOverride
  }

  if (allowInsecure) {
    tls.allowInsecure = true
  }

  return Object.keys(tls).length > 0 ? tls : undefined
}

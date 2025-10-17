import { loadTemporalConfig, type TemporalConfig, type TLSConfig } from './config'
import { native, type NativeClient, type Runtime } from './internal/core-bridge/native.js'

export interface CreateTemporalClientOptions {
  config?: TemporalConfig
  clientName?: string
  clientVersion?: string
}

export interface TemporalClient {
  readonly config: TemporalConfig
  readonly runtime: Runtime
  readonly handle: NativeClient
  close(): void
  isClosed(): boolean
}

const encodeTls = (tls?: TLSConfig) => {
  if (!tls) return undefined
  return {
    serverRootCACertificate: tls.serverRootCACertificate?.toString('base64'),
    clientCertPair: tls.clientCertPair
      ? {
          crt: tls.clientCertPair.crt.toString('base64'),
          key: tls.clientCertPair.key.toString('base64'),
        }
      : undefined,
    serverNameOverride: tls.serverNameOverride,
  }
}

class BunTemporalClient implements TemporalClient {
  public readonly config: TemporalConfig
  public readonly runtime: Runtime
  public readonly handle: NativeClient
  #closed = false

  constructor(runtime: Runtime, client: NativeClient, config: TemporalConfig) {
    this.runtime = runtime
    this.handle = client
    this.config = config
  }

  close(): void {
    if (this.#closed) return
    native.clientShutdown(this.handle)
    native.runtimeShutdown(this.runtime)
    this.#closed = true
  }

  isClosed(): boolean {
    return this.#closed
  }
}

export const createTemporalClient = async (options: CreateTemporalClientOptions = {}) => {
  const config = options.config ?? (await loadTemporalConfig())

  if (config.allowInsecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }

  const runtime = native.createRuntime({})
  try {
    const handle = native.createClient(runtime, {
      address: config.address,
      namespace: config.namespace,
      identity: config.workerIdentity,
      clientName: options.clientName ?? 'temporal-bun-sdk',
      clientVersion: options.clientVersion ?? process.env.npm_package_version ?? '0.0.0-dev',
      apiKey: config.apiKey,
      tls: encodeTls(config.tls),
    })

    const client = new BunTemporalClient(runtime, handle, config)
    return { client, config }
  } catch (error) {
    native.runtimeShutdown(runtime)
    throw error
  }
}

export const withTemporalClient = async <T>(fn: (client: TemporalClient) => Promise<T>): Promise<T> => {
  const { client } = await createTemporalClient()
  try {
    return await fn(client)
  } finally {
    client.close()
  }
}

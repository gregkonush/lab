import { Buffer } from 'node:buffer'
import { fileURLToPath } from 'node:url'
import { WorkerRuntime, type ActivityRegistryInput } from './worker/runtime.ts'
import type { ClientTlsOptions } from './core-bridge/client.ts'
import { loadTemporalConfig, type TemporalConfig, type TLSConfig } from './config.ts'
import * as defaultActivities from './activities/index.ts'

const DEFAULT_WORKFLOWS_PATH = fileURLToPath(new URL('./workflows/index.js', import.meta.url))

export interface CreateWorkerOptions {
  config?: TemporalConfig
  address?: string
  namespace?: string
  identity?: string
  taskQueue?: string
  workflowsPath?: string
  activities?: ActivityRegistryInput
  runtimeOptions?: Record<string, unknown>
  concurrency?: { workflow?: number; activity?: number }
}

export interface CreateWorkerResult {
  runtime: WorkerRuntime
  config: TemporalConfig
  taskQueue: string
}

export const createWorker = async (options: CreateWorkerOptions = {}): Promise<CreateWorkerResult> => {
  const config = options.config ?? (await loadTemporalConfig())

  if (config.allowInsecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }

  const address = options.address ?? config.address
  const namespace = options.namespace ?? config.namespace
  const identity = options.identity ?? config.workerIdentity
  const taskQueue = options.taskQueue ?? config.taskQueue
  const workflowsPath = options.workflowsPath ?? DEFAULT_WORKFLOWS_PATH
  const activities = options.activities ?? (defaultActivities as ActivityRegistryInput)

  const runtime = await WorkerRuntime.create({
    workflowsPath,
    activities,
    taskQueue,
    namespace,
    runtimeOptions: options.runtimeOptions,
    concurrency: options.concurrency,
    clientOptions: {
      address,
      namespace,
      identity,
      apiKey: config.apiKey,
      clientName: 'temporal-bun-sdk-worker',
      clientVersion: process.env.npm_package_version,
      tls: toClientTlsOptions(config.tls),
    },
  })

  return {
    runtime,
    config,
    taskQueue,
  }
}

export const runWorker = async (options?: CreateWorkerOptions): Promise<WorkerRuntime> => {
  const { runtime } = await createWorker(options)
  await runtime.run()
  return runtime
}

const toClientTlsOptions = (tls?: TLSConfig): ClientTlsOptions | undefined => {
  if (!tls) return undefined

  const ca = tls.serverRootCACertificate ? Buffer.from(tls.serverRootCACertificate).toString('base64') : undefined
  const clientCert = tls.clientCertPair?.crt ? Buffer.from(tls.clientCertPair.crt).toString('base64') : undefined
  const clientKey = tls.clientCertPair?.key ? Buffer.from(tls.clientCertPair.key).toString('base64') : undefined
  const serverName = tls.serverNameOverride

  const payload: ClientTlsOptions = {
    ...(ca ? { serverRootCACertificate: ca } : {}),
    ...(clientCert && clientKey ? { clientCert, clientPrivateKey: clientKey } : {}),
    ...(serverName ? { serverNameOverride: serverName } : {}),
  }

  return Object.keys(payload).length > 0 ? payload : undefined
}

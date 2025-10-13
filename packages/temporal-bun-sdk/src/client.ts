import { Connection, WorkflowClient } from '@temporalio/client'
import type { ConnectionOptions, WorkflowClientOptions } from '@temporalio/client'
import { loadTemporalConfig, type TemporalConfig } from './config'

export interface CreateTemporalConnectionOptions {
  config?: TemporalConfig
  connectionOptions?: ConnectionOptions
}

export const createTemporalConnection = async (options: CreateTemporalConnectionOptions = {}): Promise<Connection> => {
  const config = options.config ?? (await loadTemporalConfig())
  const baseOptions: ConnectionOptions = {
    address: config.address,
    ...(options.connectionOptions ?? {}),
  }

  if (config.apiKey && baseOptions.apiKey === undefined) {
    baseOptions.apiKey = config.apiKey
  }

  if (config.tls && baseOptions.tls === undefined) {
    baseOptions.tls = config.tls
  }

  if (config.allowInsecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }

  return await Connection.connect(baseOptions)
}

export interface CreateTemporalClientOptions extends CreateTemporalConnectionOptions {
  connection?: Connection
  clientOptions?: WorkflowClientOptions
}

export const createTemporalClient = async (options: CreateTemporalClientOptions = {}) => {
  const config = options.config ?? (await loadTemporalConfig())
  const connection =
    options.connection ??
    (await createTemporalConnection({
      config,
      connectionOptions: options.connectionOptions,
    }))

  const client = new WorkflowClient({
    connection,
    namespace: options.clientOptions?.namespace ?? config.namespace,
    ...(options.clientOptions ?? {}),
  })

  return { client, connection, config }
}

import { z } from 'zod'
import { loadTemporalConfig, type TemporalConfig, type TLSConfig } from './config'
import { native, type NativeClient, type Runtime } from './internal/core-bridge/native'

const startWorkflowResponseSchema = z.object({
  runId: z.string().min(1),
  workflowId: z.string().min(1),
  namespace: z.string().min(1),
})

const retryPolicySchema = z
  .object({
    initialIntervalMs: z.number().int().positive().optional(),
    maximumIntervalMs: z.number().int().positive().optional(),
    maximumAttempts: z.number().int().optional(),
    backoffCoefficient: z.number().positive().optional(),
    nonRetryableErrorTypes: z.array(z.string().min(1)).optional(),
  })
  .optional()

const startWorkflowOptionsSchema = z.object({
  workflowId: z.string().min(1),
  workflowType: z.string().min(1),
  args: z.array(z.unknown()).optional(),
  taskQueue: z.string().min(1).optional(),
  namespace: z.string().min(1).optional(),
  identity: z.string().min(1).optional(),
  cronSchedule: z.string().min(1).optional(),
  memo: z.record(z.unknown()).optional(),
  headers: z.record(z.unknown()).optional(),
  searchAttributes: z.record(z.unknown()).optional(),
  requestId: z.string().min(1).optional(),
  workflowExecutionTimeoutMs: z.number().int().positive().optional(),
  workflowRunTimeoutMs: z.number().int().positive().optional(),
  workflowTaskTimeoutMs: z.number().int().positive().optional(),
  retryPolicy: retryPolicySchema,
})

export interface RetryPolicyOptions {
  initialIntervalMs?: number
  maximumIntervalMs?: number
  maximumAttempts?: number
  backoffCoefficient?: number
  nonRetryableErrorTypes?: string[]
}

export interface StartWorkflowOptions {
  workflowId: string
  workflowType: string
  args?: unknown[]
  taskQueue?: string
  namespace?: string
  identity?: string
  cronSchedule?: string
  memo?: Record<string, unknown>
  headers?: Record<string, unknown>
  searchAttributes?: Record<string, unknown>
  requestId?: string
  workflowExecutionTimeoutMs?: number
  workflowRunTimeoutMs?: number
  workflowTaskTimeoutMs?: number
  retryPolicy?: RetryPolicyOptions
}

export type StartWorkflowResult = z.infer<typeof startWorkflowResponseSchema>

export interface TemporalWorkflowClient {
  start(options: StartWorkflowOptions): Promise<StartWorkflowResult>
}

export interface TemporalClient {
  readonly namespace: string
  readonly config: TemporalConfig
  readonly workflow: TemporalWorkflowClient
  startWorkflow(options: StartWorkflowOptions): Promise<StartWorkflowResult>
  describeNamespace(namespace?: string): Promise<Uint8Array>
  shutdown(): Promise<void>
}

export interface CreateTemporalClientOptions {
  config?: TemporalConfig
  runtimeOptions?: Record<string, unknown>
  namespace?: string
  identity?: string
  taskQueue?: string
}

const textDecoder = new TextDecoder()

export const createTemporalClient = async (
  options: CreateTemporalClientOptions = {},
): Promise<{ client: TemporalClient; config: TemporalConfig }> => {
  const config = options.config ?? (await loadTemporalConfig())

  if (config.allowInsecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }

  const namespace = options.namespace ?? config.namespace
  const identity = options.identity ?? config.workerIdentity
  const taskQueue = options.taskQueue ?? config.taskQueue

  const runtime = native.createRuntime(options.runtimeOptions ?? {})
  const nativeConfig: Record<string, unknown> = {
    address: formatTemporalAddress(config.address, Boolean(config.tls)),
    namespace,
    identity,
  }

  if (config.apiKey) {
    nativeConfig.apiKey = config.apiKey
  }

  const tlsPayload = serializeTlsConfig(config.tls)
  if (tlsPayload) {
    nativeConfig.tls = tlsPayload
  }

  if (config.allowInsecureTls) {
    nativeConfig.allowInsecure = true
  }

  const clientHandle = await native.createClient(runtime, nativeConfig)

  const client = new TemporalClientImpl({
    runtime,
    client: clientHandle,
    config,
    namespace,
    identity,
    taskQueue,
  })

  return { client, config }
}

class TemporalClientImpl implements TemporalClient {
  readonly namespace: string
  readonly config: TemporalConfig
  readonly workflow: TemporalWorkflowClient

  private closed = false
  private readonly runtime: Runtime
  private readonly client: NativeClient
  private readonly defaultIdentity: string
  private readonly defaultTaskQueue: string

  constructor(handles: {
    runtime: Runtime
    client: NativeClient
    config: TemporalConfig
    namespace: string
    identity: string
    taskQueue: string
  }) {
    this.runtime = handles.runtime
    this.client = handles.client
    this.config = handles.config
    this.namespace = handles.namespace
    this.defaultIdentity = handles.identity
    this.defaultTaskQueue = handles.taskQueue
    this.workflow = {
      start: (options) => this.startWorkflow(options),
    }
  }

  async startWorkflow(options: StartWorkflowOptions): Promise<StartWorkflowResult> {
    const parsed = startWorkflowOptionsSchema.parse(options)
    const payload = buildStartWorkflowPayload({
      options: parsed,
      defaults: {
        namespace: this.namespace,
        identity: this.defaultIdentity,
        taskQueue: this.defaultTaskQueue,
      },
    })

    const bytes = await native.startWorkflow(this.client, payload)
    const response = parseJson(bytes)
    return startWorkflowResponseSchema.parse(response)
  }

  async describeNamespace(targetNamespace?: string): Promise<Uint8Array> {
    return native.describeNamespace(this.client, targetNamespace ?? this.namespace)
  }

  async shutdown(): Promise<void> {
    if (this.closed) return
    this.closed = true
    native.clientShutdown(this.client)
    native.runtimeShutdown(this.runtime)
  }
}

const parseJson = (bytes: Uint8Array): unknown => {
  const text = textDecoder.decode(bytes)
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new Error(`Failed to parse Temporal bridge response: ${(error as Error).message}`)
  }
}

const buildStartWorkflowPayload = ({
  options,
  defaults,
}: {
  options: z.infer<typeof startWorkflowOptionsSchema>
  defaults: { namespace: string; identity: string; taskQueue: string }
}): Record<string, unknown> => {
  const payload: Record<string, unknown> = {
    namespace: options.namespace ?? defaults.namespace,
    workflow_id: options.workflowId,
    workflow_type: options.workflowType,
    task_queue: options.taskQueue ?? defaults.taskQueue,
    identity: options.identity ?? defaults.identity,
    args: options.args ?? [],
  }

  if (options.cronSchedule) {
    payload.cron_schedule = options.cronSchedule
  }

  if (options.memo) {
    payload.memo = options.memo
  }

  if (options.headers) {
    payload.headers = options.headers
  }

  if (options.searchAttributes) {
    payload.search_attributes = options.searchAttributes
  }

  if (options.requestId) {
    payload.request_id = options.requestId
  }

  if (options.workflowExecutionTimeoutMs) {
    payload.workflow_execution_timeout_ms = options.workflowExecutionTimeoutMs
  }

  if (options.workflowRunTimeoutMs) {
    payload.workflow_run_timeout_ms = options.workflowRunTimeoutMs
  }

  if (options.workflowTaskTimeoutMs) {
    payload.workflow_task_timeout_ms = options.workflowTaskTimeoutMs
  }

  if (options.retryPolicy) {
    payload.retry_policy = buildRetryPolicy(options.retryPolicy)
  }

  return payload
}

const buildRetryPolicy = (policy: RetryPolicyOptions): Record<string, unknown> => {
  const payload: Record<string, unknown> = {}
  if (policy.initialIntervalMs !== undefined) {
    payload.initial_interval_ms = policy.initialIntervalMs
  }
  if (policy.maximumIntervalMs !== undefined) {
    payload.maximum_interval_ms = policy.maximumIntervalMs
  }
  if (policy.maximumAttempts !== undefined) {
    payload.maximum_attempts = policy.maximumAttempts
  }
  if (policy.backoffCoefficient !== undefined) {
    payload.backoff_coefficient = policy.backoffCoefficient
  }
  if (policy.nonRetryableErrorTypes && policy.nonRetryableErrorTypes.length > 0) {
    payload.non_retryable_error_types = policy.nonRetryableErrorTypes
  }
  return payload
}

const formatTemporalAddress = (address: string, useTls: boolean): string => {
  if (/^https?:\/\//i.test(address)) {
    return address
  }
  return `${useTls ? 'https' : 'http'}://${address}`
}

const serializeTlsConfig = (tls?: TLSConfig): Record<string, unknown> | undefined => {
  if (!tls) return undefined

  const payload: Record<string, unknown> = {}
  const encode = (buffer?: Buffer) => buffer?.toString('base64')

  const caCertificate = encode(tls.serverRootCACertificate)
  if (caCertificate) {
    payload.server_root_ca_cert = caCertificate
  }

  const clientCert = encode(tls.clientCertPair?.crt)
  const clientPrivateKey = encode(tls.clientCertPair?.key)
  if (clientCert && clientPrivateKey) {
    payload.client_cert = clientCert
    payload.client_private_key = clientPrivateKey
  }

  if (tls.serverNameOverride) {
    payload.server_name_override = tls.serverNameOverride
  }

  if (Object.keys(payload).length === 0) {
    return undefined
  }

  return payload
}

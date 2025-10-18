import { native, type NativeClient } from '../internal/core-bridge/native.ts'
import { TemporalRuntime } from './runtime.ts'
import { TemporalBridgeError, wrapNativeError } from './errors.ts'

const finalizeClient = (client: NativeClient): void => {
  try {
    native.clientShutdown(client)
  } catch {
    // Best-effort cleanup; ignore errors during GC finalization.
  }
}

const clientFinalizer = new FinalizationRegistry<NativeClient>(finalizeClient)
const namespaceJsonDecoder = new TextDecoder()
const ADDRESS_WITH_PROTOCOL = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//

export interface ClientTlsOptions {
  readonly serverRootCACertificate?: string
  readonly clientCert?: string
  readonly clientPrivateKey?: string
  readonly serverNameOverride?: string
  readonly allowInsecure?: boolean
}

export interface ClientOptions {
  readonly address: string
  readonly namespace: string
  readonly identity?: string
  readonly clientName?: string
  readonly clientVersion?: string
  readonly apiKey?: string
  readonly tls?: ClientTlsOptions
  readonly allowInsecureTls?: boolean
}

export class Client {
  #native: NativeClient | undefined
  readonly namespace: string

  static async connect(runtime: TemporalRuntime, options: ClientOptions): Promise<Client> {
    const client = new Client(runtime, options)
    await client.#init()
    return client
  }

  private constructor(
    private readonly runtime: TemporalRuntime,
    private readonly options: ClientOptions,
  ) {
    this.namespace = options.namespace
  }

  async #init(): Promise<void> {
    const payload: Record<string, unknown> = {
      address: normalizeTemporalAddress(
        this.options.address,
        Boolean(this.options.tls) || Boolean(this.options.allowInsecureTls),
      ),
      namespace: this.options.namespace,
      identity: this.options.identity,
      client_name: this.options.clientName,
      client_version: this.options.clientVersion,
    }

    if (this.options.apiKey) {
      payload.api_key = this.options.apiKey
    }

    const tlsPayload = serializeTlsOptions(this.options.tls, this.options.allowInsecureTls)
    if (tlsPayload) {
      payload.tls = tlsPayload
    }

    this.#native = await native.createClient(this.runtime.native, payload)
    clientFinalizer.register(this, this.#native, this)
  }

  get nativeHandle(): NativeClient {
    if (!this.#native) {
      throw new Error('Client has already been shut down')
    }
    return this.#native
  }

  async describeNamespace(namespace = this.namespace): Promise<Uint8Array> {
    const handle = this.nativeHandle
    return await native.describeNamespace(handle, namespace)
  }

  async shutdown(): Promise<void> {
    if (!this.#native) return
    native.clientShutdown(this.#native)
    clientFinalizer.unregister(this)
    this.#native = undefined
  }
}

export const createClient = async (runtime: TemporalRuntime, options: ClientOptions): Promise<Client> => {
  return await Client.connect(runtime, options)
}

export interface NativeClientConfig extends ClientOptions {
  readonly defaultTaskQueue?: string
}

export interface StartWorkflowRetryPolicy {
  initialIntervalMs?: number
  backoffCoefficient?: number
  maximumIntervalMs?: number
  maximumAttempts?: number
  nonRetryableErrorTypes?: string[]
}

export interface StartWorkflowOptions {
  workflowId: string
  workflowType: string
  taskQueue?: string
  args?: unknown[]
  memo?: Record<string, unknown>
  searchAttributes?: Record<string, unknown[]>
  headers?: Record<string, unknown>
  workflowExecutionTimeoutMs?: number
  workflowRunTimeoutMs?: number
  workflowTaskTimeoutMs?: number
  cronSchedule?: string
  retryPolicy?: StartWorkflowRetryPolicy
  identity?: string
  requestId?: string
  namespace?: string
}

export interface StartWorkflowResult {
  runId: string
  workflowId: string
  namespace: string
}

export interface SignalWorkflowOptions {
  workflowId: string
  signalName: string
  args?: unknown[]
  headers?: Record<string, unknown>
  namespace?: string
  runId?: string
  identity?: string
  requestId?: string
}

export interface SignalWorkflowResult {
  workflowId: string
  runId?: string
  signalName: string
  namespace: string
}

export interface TemporalCoreClientOptions {
  runtime: TemporalRuntime
  nativeClient: NativeClient
  defaults: {
    namespace: string
    identity: string
    taskQueue?: string
  }
}

type DescribeNamespaceResponse = Record<string, unknown>

export class TemporalCoreClient {
  #runtime: TemporalRuntime
  #native: NativeClient | undefined
  #namespace: string
  #identity: string
  #defaultTaskQueue?: string

  constructor(options: TemporalCoreClientOptions) {
    this.#runtime = options.runtime
    this.#native = options.nativeClient
    this.#namespace = options.defaults.namespace
    this.#identity = options.defaults.identity
    this.#defaultTaskQueue = options.defaults.taskQueue
    clientFinalizer.register(this, this.#native, this)
  }

  get namespace(): string {
    return this.#namespace
  }

  get identity(): string {
    return this.#identity
  }

  async describeNamespace(namespace = this.#namespace): Promise<DescribeNamespaceResponse> {
    try {
      const bytes = await native.describeNamespace(this.#getNative(), namespace)
      const json = namespaceJsonDecoder.decode(bytes)
      return JSON.parse(json) as DescribeNamespaceResponse
    } catch (error) {
      throw wrapNativeError(error, `Failed to describe Temporal namespace "${namespace}"`)
    }
  }

  async startWorkflow(options: StartWorkflowOptions): Promise<StartWorkflowResult> {
    const taskQueue = options.taskQueue ?? this.#defaultTaskQueue
    if (!taskQueue) {
      throw new TemporalBridgeError('Workflow task queue is required')
    }

    const request = buildStartWorkflowRequest({
      namespace: options.namespace ?? this.#namespace,
      workflowId: options.workflowId,
      workflowType: options.workflowType,
      taskQueue,
      identity: options.identity ?? this.#identity,
      requestId: options.requestId,
      args: options.args,
      memo: options.memo,
      searchAttributes: options.searchAttributes,
      headers: options.headers,
      workflowExecutionTimeoutMs: options.workflowExecutionTimeoutMs,
      workflowRunTimeoutMs: options.workflowRunTimeoutMs,
      workflowTaskTimeoutMs: options.workflowTaskTimeoutMs,
      cronSchedule: options.cronSchedule,
      retryPolicy: options.retryPolicy,
    })

    try {
      const json = native.startWorkflow(this.#getNative(), request)
      const parsed = JSON.parse(json) as Partial<{
        run_id: string
        workflow_id: string
        namespace: string
      }>

      if (
        !parsed ||
        typeof parsed.run_id !== 'string' ||
        typeof parsed.workflow_id !== 'string' ||
        typeof parsed.namespace !== 'string'
      ) {
        throw new TemporalBridgeError('Received invalid response from workflow start', {
          details: parsed,
        })
      }

      return {
        runId: parsed.run_id,
        workflowId: parsed.workflow_id,
        namespace: parsed.namespace,
      }
    } catch (error) {
      throw wrapNativeError(error, `Failed to start workflow "${options.workflowType}"`)
    }
  }

  async signalWorkflow(options: SignalWorkflowOptions): Promise<SignalWorkflowResult> {
    const request = buildSignalWorkflowRequest({
      namespace: options.namespace ?? this.#namespace,
      workflowId: options.workflowId,
      runId: options.runId,
      signalName: options.signalName,
      args: options.args,
      headers: options.headers,
      identity: options.identity ?? this.#identity,
      requestId: options.requestId,
    })

    try {
      const json = native.signalWorkflow(this.#getNative(), request)
      const parsed = JSON.parse(json) as Partial<{
        workflow_id: string
        run_id?: string
        signal_name: string
        namespace: string
      }>

      if (
        !parsed ||
        typeof parsed.workflow_id !== 'string' ||
        typeof parsed.signal_name !== 'string' ||
        typeof parsed.namespace !== 'string'
      ) {
        throw new TemporalBridgeError('Received invalid response from workflow signal', {
          details: parsed,
        })
      }

      return {
        workflowId: parsed.workflow_id,
        signalName: parsed.signal_name,
        namespace: parsed.namespace,
        runId: parsed.run_id,
      }
    } catch (error) {
      throw wrapNativeError(error, `Failed to signal workflow "${options.workflowId}"`)
    }
  }

  async shutdown(): Promise<void> {
    if (!this.#native) return
    clientFinalizer.unregister(this)
    try {
      native.clientShutdown(this.#native)
    } catch (error) {
      throw wrapNativeError(error, 'Failed to shut down Temporal client')
    } finally {
      this.#native = undefined
    }
  }

  #getNative(): NativeClient {
    if (!this.#native) {
      throw new TemporalBridgeError('Client has already been shut down')
    }
    return this.#native
  }
}

export const createNativeClient = async (runtime: TemporalRuntime, config: NativeClientConfig) => {
  const payload: Record<string, unknown> = {
    address: normalizeTemporalAddress(config.address, Boolean(config.tls) || Boolean(config.allowInsecureTls)),
    namespace: config.namespace,
    identity: config.identity,
    client_name: config.clientName,
    client_version: config.clientVersion,
  }

  if (config.apiKey) {
    payload.api_key = config.apiKey
  }

  const tlsPayload = serializeTlsOptions(config.tls, config.allowInsecureTls)
  if (tlsPayload) {
    payload.tls = tlsPayload
  }

  try {
    const nativeClient = await native.createClient(runtime.native, payload)
    return new TemporalCoreClient({
      runtime,
      nativeClient,
      defaults: {
        namespace: config.namespace,
        identity: config.identity ?? 'temporal-bun-client',
        taskQueue: config.defaultTaskQueue,
      },
    })
  } catch (error) {
    throw wrapNativeError(error, 'Failed to create Temporal client')
  }
}

export const normalizeTemporalAddress = (address: string, useTls = false): string => {
  if (ADDRESS_WITH_PROTOCOL.test(address)) {
    return address
  }
  const scheme = useTls ? 'https' : 'http'
  return `${scheme}://${address}`
}

const serializeTlsOptions = (
  tls?: ClientTlsOptions,
  allowInsecure?: boolean,
): Record<string, string | boolean> | undefined => {
  const payload: Record<string, string | boolean> = {}

  if (tls?.serverRootCACertificate) {
    payload.server_root_ca_cert = tls.serverRootCACertificate
  }

  if (tls?.clientCert) {
    payload.client_cert = tls.clientCert
  }

  if (tls?.clientPrivateKey) {
    payload.client_private_key = tls.clientPrivateKey
  }

  if (tls?.serverNameOverride) {
    payload.server_name_override = tls.serverNameOverride
  }

  const allowInsecureFlag = allowInsecure === true || tls?.allowInsecure === true

  if (allowInsecureFlag) {
    payload.allow_insecure = true
  }

  return Object.keys(payload).length > 0 ? payload : undefined
}

interface StartWorkflowBuildInput {
  namespace: string
  workflowId: string
  workflowType: string
  taskQueue: string
  identity: string
  requestId?: string
  args?: unknown[]
  memo?: Record<string, unknown>
  searchAttributes?: Record<string, unknown[]>
  headers?: Record<string, unknown>
  workflowExecutionTimeoutMs?: number
  workflowRunTimeoutMs?: number
  workflowTaskTimeoutMs?: number
  cronSchedule?: string
  retryPolicy?: StartWorkflowRetryPolicy
}

const buildStartWorkflowRequest = (input: StartWorkflowBuildInput): Record<string, unknown> => {
  const request: Record<string, unknown> = {
    namespace: input.namespace,
    workflow_id: input.workflowId,
    workflow_type: input.workflowType,
    task_queue: input.taskQueue,
    identity: input.identity,
  }

  if (input.requestId) {
    request.request_id = input.requestId
  }

  if (input.args && input.args.length > 0) {
    request.args = input.args
  }

  if (input.memo && Object.keys(input.memo).length > 0) {
    request.memo = input.memo
  }

  if (input.searchAttributes && Object.keys(input.searchAttributes).length > 0) {
    request.search_attributes = input.searchAttributes
  }

  if (input.headers && Object.keys(input.headers).length > 0) {
    request.headers = input.headers
  }

  if (typeof input.workflowExecutionTimeoutMs === 'number') {
    request.workflow_execution_timeout_ms = input.workflowExecutionTimeoutMs
  }

  if (typeof input.workflowRunTimeoutMs === 'number') {
    request.workflow_run_timeout_ms = input.workflowRunTimeoutMs
  }

  if (typeof input.workflowTaskTimeoutMs === 'number') {
    request.workflow_task_timeout_ms = input.workflowTaskTimeoutMs
  }

  if (input.cronSchedule) {
    request.cron_schedule = input.cronSchedule
  }

  if (input.retryPolicy) {
    const policy: Record<string, unknown> = {}
    if (typeof input.retryPolicy.initialIntervalMs === 'number') {
      policy.initial_interval_ms = input.retryPolicy.initialIntervalMs
    }
    if (typeof input.retryPolicy.backoffCoefficient === 'number') {
      policy.backoff_coefficient = input.retryPolicy.backoffCoefficient
    }
    if (typeof input.retryPolicy.maximumIntervalMs === 'number') {
      policy.maximum_interval_ms = input.retryPolicy.maximumIntervalMs
    }
    if (typeof input.retryPolicy.maximumAttempts === 'number') {
      policy.maximum_attempts = input.retryPolicy.maximumAttempts
    }
    if (input.retryPolicy.nonRetryableErrorTypes && input.retryPolicy.nonRetryableErrorTypes.length > 0) {
      policy.non_retryable_error_types = input.retryPolicy.nonRetryableErrorTypes
    }
    if (Object.keys(policy).length > 0) {
      request.retry_policy = policy
    }
  }

  return request
}

interface SignalWorkflowBuildInput {
  namespace: string
  workflowId: string
  runId?: string
  signalName: string
  args?: unknown[]
  headers?: Record<string, unknown>
  identity: string
  requestId?: string
}

const buildSignalWorkflowRequest = (input: SignalWorkflowBuildInput): Record<string, unknown> => {
  const request: Record<string, unknown> = {
    namespace: input.namespace,
    workflow_id: input.workflowId,
    signal_name: input.signalName,
    identity: input.identity,
  }

  if (input.runId) {
    request.run_id = input.runId
  }

  if (input.args && input.args.length > 0) {
    request.args = input.args
  }

  if (input.headers && Object.keys(input.headers).length > 0) {
    request.headers = input.headers
  }

  if (input.requestId) {
    request.request_id = input.requestId
  }

  return request
}

export const __TEST__ = {
  finalizeClient,
  serializeTlsOptions,
}

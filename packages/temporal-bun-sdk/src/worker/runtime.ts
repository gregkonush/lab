import { createClient, type Client, type ClientOptions } from '../core-bridge/client.ts'
import { createRuntime, type Runtime } from '../core-bridge/runtime.ts'
import { native, type NativeWorker } from '../internal/worker/native.ts'
import {
  WorkflowIsolateManager,
  type WorkflowActivation,
  type WorkflowCompletion,
  type WorkflowActivationJob,
} from './isolate-manager.ts'
import { createPollingLoop } from './polling-loop.ts'

const DEFAULT_WORKFLOW_CONCURRENCY = 8
const DEFAULT_ACTIVITY_CONCURRENCY = 16
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000
const MIN_HEARTBEAT_INTERVAL_MS = 100

const textDecoder = new TextDecoder()

export type ActivityFunction = (...args: unknown[]) => unknown | Promise<unknown>

export type ActivityRegistryInput =
  | Record<string, ActivityFunction>
  | Map<string, ActivityFunction>
  | Iterable<[string, ActivityFunction]>

export interface WorkerRuntimeOptions {
  workflowsPath: string
  activities?: ActivityRegistryInput
  taskQueue: string
  namespace: string
  clientOptions: ClientOptions
  runtimeOptions?: Record<string, unknown>
  concurrency?: { workflow?: number; activity?: number }
}

interface ActivityTaskPayload {
  taskToken: string
  activityType: string
  args: unknown[]
  workflowRunId?: string
  workflowId?: string
  heartbeatDetails?: unknown
  heartbeatTimeoutMs?: number
  timeoutMs?: number
}

type ActivityCompletionOutcome = { status: 'completed'; result?: unknown } | { status: 'failed'; error: unknown }

type WorkerState = 'idle' | 'running' | 'shutting-down' | 'stopped'

interface Deferred<T> {
  resolve(value: T | PromiseLike<T>): void
  reject(reason?: unknown): void
  promise: Promise<T>
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve!: Deferred<T>['resolve']
  let reject!: Deferred<T>['reject']
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { resolve, reject, promise }
}

export class WorkerRuntime {
  static async create(options: WorkerRuntimeOptions): Promise<WorkerRuntime> {
    validateWorkerOptions(options)

    const runtime = createRuntime({ options: options.runtimeOptions })
    const client = await createClient(runtime, {
      ...options.clientOptions,
      namespace: options.clientOptions.namespace ?? options.namespace,
    })

    const workerPayload: Record<string, unknown> = {
      task_queue: options.taskQueue,
      namespace: options.namespace ?? options.clientOptions.namespace,
      max_concurrent_workflow_tasks: options.concurrency?.workflow ?? DEFAULT_WORKFLOW_CONCURRENCY,
      max_concurrent_activity_tasks: options.concurrency?.activity ?? DEFAULT_ACTIVITY_CONCURRENCY,
    }

    const workerHandle = native.createWorker(runtime.nativeHandle, client.nativeHandle, workerPayload)

    return new WorkerRuntime({
      options,
      runtime,
      client,
      worker: workerHandle,
      workflowConcurrency: workerPayload.max_concurrent_workflow_tasks as number,
      activityConcurrency: workerPayload.max_concurrent_activity_tasks as number,
      activities: normalizeActivities(options.activities),
    })
  }

  #state: WorkerState = 'idle'
  #runtime: Runtime
  #client: Client
  #worker: NativeWorker
  #workflowManager: WorkflowIsolateManager
  #workflowConcurrency: number
  #activityConcurrency: number
  #activities: Map<string, ActivityFunction>
  #workflowAbort?: AbortController
  #activityAbort?: AbortController
  #workflowLoops: Promise<void>[] = []
  #activityLoops: Promise<void>[] = []
  #pollingPromise?: Promise<void>
  #shutdownDeferred = createDeferred<void>()
  #shutdownPromise?: Promise<void>
  #activeWorkflowTasks = 0
  #activeActivityTasks = 0
  #stopped = false

  private constructor(params: {
    options: WorkerRuntimeOptions
    runtime: Runtime
    client: Client
    worker: NativeWorker
    workflowConcurrency: number
    activityConcurrency: number
    activities: Map<string, ActivityFunction>
  }) {
    this.options = params.options
    this.#runtime = params.runtime
    this.#client = params.client
    this.#worker = params.worker
    this.#workflowManager = new WorkflowIsolateManager(params.options.workflowsPath)
    this.#workflowConcurrency = params.workflowConcurrency
    this.#activityConcurrency = params.activityConcurrency
    this.#activities = params.activities
  }

  readonly options: WorkerRuntimeOptions

  get state(): WorkerState {
    return this.#state
  }

  get activeWorkflowTasks(): number {
    return this.#activeWorkflowTasks
  }

  get activeActivityTasks(): number {
    return this.#activeActivityTasks
  }

  async run(): Promise<void> {
    if (this.#state === 'stopped') {
      throw new Error('WorkerRuntime has already been shut down')
    }
    if (this.#state === 'running') {
      throw new Error('WorkerRuntime is already running')
    }
    if (this.#state === 'shutting-down') {
      throw new Error('WorkerRuntime is shutting down')
    }

    this.#state = 'running'
    this.#workflowAbort = new AbortController()
    this.#activityAbort = new AbortController()

    this.#workflowLoops = Array.from({ length: this.#workflowConcurrency }, () =>
      createPollingLoop({
        signal: this.#workflowAbort!.signal,
        poll: () => native.pollWorkflowTask(this.#worker),
        handler: async (payload) => {
          this.#activeWorkflowTasks += 1
          try {
            await this.#handleWorkflowTask(payload)
          } finally {
            this.#activeWorkflowTasks -= 1
          }
        },
        onError: (error) => this.#handleLoopError('workflow', error),
      }),
    )
    this.#activityLoops = Array.from({ length: this.#activityConcurrency }, () =>
      createPollingLoop({
        signal: this.#activityAbort!.signal,
        poll: () => native.pollActivityTask(this.#worker),
        handler: async (payload) => {
          this.#activeActivityTasks += 1
          try {
            await this.#handleActivityTask(payload)
          } finally {
            this.#activeActivityTasks -= 1
          }
        },
        onError: (error) => this.#handleLoopError('activity', error),
      }),
    )

    this.#pollingPromise = Promise.allSettled([...this.#workflowLoops, ...this.#activityLoops]).then(() => {
      if (!this.#stopped) {
        this.#shutdownDeferred.resolve()
      }
    })

    await this.#shutdownDeferred.promise
  }

  async shutdown(gracefulTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    if (this.#stopped) {
      return
    }

    if (!this.#shutdownPromise) {
      this.#shutdownPromise = this.#performShutdown(gracefulTimeoutMs)
    }

    await this.#shutdownPromise
  }

  async #performShutdown(gracefulTimeoutMs: number): Promise<void> {
    if (this.#state === 'idle') {
      this.#state = 'shutting-down'
    } else if (this.#state === 'running') {
      this.#state = 'shutting-down'
    } else if (this.#state === 'stopped') {
      return
    }

    try {
      native.initiateShutdown(this.#worker)
    } catch (error) {
      this.#handleLoopError('worker', error)
    }

    this.#workflowAbort?.abort()
    this.#activityAbort?.abort()

    const waitForLoops = async (): Promise<void> => {
      if (!this.#pollingPromise) return
      await this.#pollingPromise
    }

    try {
      await settleWithTimeout(waitForLoops(), gracefulTimeoutMs)
    } catch (error) {
      this.#handleLoopError('worker', error)
    }

    try {
      native.finalizeShutdown(this.#worker)
    } catch (error) {
      this.#handleLoopError('worker', error)
    }

    try {
      await this.#workflowManager.shutdown()
    } catch (error) {
      this.#handleLoopError('worker', error)
    }

    native.workerShutdown(this.#worker)

    const shutdownResults = await Promise.allSettled([this.#client.shutdown(), this.#runtime.shutdown()])
    shutdownResults.forEach((result) => {
      if (result.status === 'rejected') {
        this.#handleLoopError('worker', result.reason)
      }
    })

    this.#stopped = true
    this.#state = 'stopped'
    this.#shutdownDeferred.resolve()
  }

  async #handleWorkflowTask(payload: Uint8Array): Promise<void> {
    const activation = decodeWorkflowActivation(payload)
    let completion: WorkflowCompletion
    try {
      completion = await this.#workflowManager.execute(activation)
    } catch (error) {
      completion = buildWorkflowFailure(activation, error)
    }

    try {
      native.completeWorkflowTask(this.#worker, { ...completion } as Record<string, unknown>)
    } catch (error) {
      this.#handleLoopError('workflow', error)
    }
  }

  async #handleActivityTask(payload: Uint8Array): Promise<void> {
    const task = decodeActivityTask(payload)
    const activity = this.#activities.get(task.activityType)

    if (!activity) {
      this.#completeActivity(task, {
        status: 'failed',
        error: new Error(`Activity \"${task.activityType}\" is not registered`),
      })
      return
    }

    const stopHeartbeat = this.#startActivityHeartbeat(task)

    try {
      const result = await runWithTimeout(Promise.resolve(activity(...task.args)), task.timeoutMs)
      stopHeartbeat()
      this.#completeActivity(task, { status: 'completed', result })
    } catch (error) {
      stopHeartbeat()
      this.#completeActivity(task, { status: 'failed', error })
    }
  }

  #handleLoopError(scope: 'workflow' | 'activity' | 'worker', error: unknown): void {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    console.error(`[temporal-bun-sdk] ${scope} loop error: ${message}`)
  }

  #completeActivity(task: ActivityTaskPayload, outcome: ActivityCompletionOutcome): void {
    const payload = buildActivityCompletion(task, outcome)
    try {
      native.completeActivityTask(this.#worker, payload)
    } catch (error) {
      this.#handleLoopError('activity', error)
    }
  }

  #startActivityHeartbeat(task: ActivityTaskPayload): () => void {
    const intervalMs = normalizeHeartbeatInterval(task.heartbeatTimeoutMs)
    if (!intervalMs) {
      return () => {}
    }

    let active = true
    const sendHeartbeat = () => {
      if (!active) return
      try {
        native.recordActivityHeartbeat(this.#worker, {
          taskToken: task.taskToken,
          details: task.heartbeatDetails ?? null,
        })
      } catch (error) {
        this.#handleLoopError('activity', error)
      }
    }

    sendHeartbeat()
    const timer = setInterval(sendHeartbeat, intervalMs)

    return () => {
      active = false
      clearInterval(timer)
    }
  }
}

const decodeWorkflowActivation = (payload: Uint8Array): WorkflowActivation => {
  const data = parseJsonPayload<Record<string, unknown>>(payload, 'workflow activation')
  const taskToken = requireString(data.taskToken, 'workflow activation taskToken')
  const runId = requireString(data.runId ?? data.workflowRunId, 'workflow activation runId')
  const workflowId = requireString(data.workflowId ?? runId, 'workflow activation workflowId')
  const workflowType = requireString(data.workflowType, 'workflow activation workflowType')

  const jobPayload = data.job
  if (!jobPayload || typeof jobPayload !== 'object') {
    throw new Error('Workflow activation is missing job payload')
  }

  const jobRecord = jobPayload as Record<string, unknown>
  const jobType = requireString(jobRecord.type, 'workflow activation job.type')
  const args = jobRecord.args == null ? [] : ensureArray(jobRecord.args)

  let job: WorkflowActivationJob
  switch (jobType) {
    case 'start':
      job = { type: 'start', args }
      break
    case 'signal': {
      const signalName = requireString(jobRecord.signalName, 'workflow activation job.signalName')
      job = { type: 'signal', args, signalName }
      break
    }
    case 'shutdown':
      job = { type: 'shutdown', args }
      break
    default:
      throw new Error(`Unsupported workflow activation job type: ${jobType}`)
  }

  return {
    taskToken,
    runId,
    workflowId,
    workflowType,
    job,
  }
}

const decodeActivityTask = (payload: Uint8Array): ActivityTaskPayload => {
  const data = parseJsonPayload<Record<string, unknown>>(payload, 'activity task')
  const taskToken = requireString(data.taskToken, 'activity task taskToken')
  const activityType = requireString(data.activityType ?? data.activity_name, 'activity task activityType')

  const argsSource = data.args ?? data.input ?? []
  const args = Array.isArray(argsSource) ? argsSource : [argsSource]

  const heartbeatTimeoutMs = toNumber(data.heartbeatTimeoutMs ?? data.heartbeat_timeout_ms)
  const timeoutMs =
    toNumber(data.startToCloseTimeoutMs ?? data.start_to_close_timeout_ms) ??
    toNumber(data.scheduleToCloseTimeoutMs ?? data.schedule_to_close_timeout_ms)

  return {
    taskToken,
    activityType,
    args,
    workflowRunId: typeof data.workflowRunId === 'string' ? data.workflowRunId : undefined,
    workflowId: typeof data.workflowId === 'string' ? data.workflowId : undefined,
    heartbeatDetails: data.heartbeatDetails ?? data.heartbeat_details,
    heartbeatTimeoutMs: heartbeatTimeoutMs ?? undefined,
    timeoutMs: timeoutMs ?? undefined,
  }
}

const buildWorkflowFailure = (activation: WorkflowActivation, error: unknown): WorkflowCompletion => ({
  taskToken: activation.taskToken,
  runId: activation.runId,
  workflowId: activation.workflowId,
  status: 'failed',
  error: serializeError(error),
})

const buildActivityCompletion = (
  task: ActivityTaskPayload,
  outcome: ActivityCompletionOutcome,
): Record<string, unknown> => {
  const base: Record<string, unknown> = {
    taskToken: task.taskToken,
    workflowRunId: task.workflowRunId,
    workflowId: task.workflowId,
  }

  if (outcome.status === 'completed') {
    if (outcome.result !== undefined) {
      base.result = outcome.result
    }
    return { ...base, status: 'completed' }
  }

  return {
    ...base,
    status: 'failed',
    error: serializeError(outcome.error),
  }
}

const parseJsonPayload = <T>(payload: Uint8Array, description: string): T => {
  try {
    const json = textDecoder.decode(payload)
    return JSON.parse(json) as T
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to parse ${description} payload: ${message}`)
  }
}

const requireString = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Expected ${field} to be a non-empty string`)
  }
  return value
}

const ensureArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) {
    return value
  }
  return [value]
}

const toNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return undefined
}

const serializeError = (error: unknown): { name?: string; message: string; stack?: string } => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  return {
    message: JSON.stringify(error),
  }
}

const normalizeHeartbeatInterval = (timeoutMs?: number): number | undefined => {
  if (!timeoutMs || timeoutMs <= 0) {
    return undefined
  }
  const half = Math.floor(timeoutMs / 2)
  return Math.max(half, MIN_HEARTBEAT_INTERVAL_MS)
}

const runWithTimeout = async <T>(promise: Promise<T>, timeoutMs?: number): Promise<T> => {
  if (!timeoutMs || timeoutMs <= 0) {
    return await promise
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`Activity timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

function normalizeActivities(input?: ActivityRegistryInput): Map<string, ActivityFunction> {
  const registry = new Map<string, ActivityFunction>()
  if (!input) return registry

  if (input instanceof Map) {
    for (const [name, fn] of input) {
      assertActivity(name, fn)
      registry.set(name, fn)
    }
    return registry
  }

  if (Array.isArray(input)) {
    for (const entry of input as Array<[string, ActivityFunction]>) {
      const [name, fn] = entry
      assertActivity(name, fn)
      registry.set(name, fn)
    }
    return registry
  }

  if (typeof (input as Iterable<[string, ActivityFunction]>)[Symbol.iterator] === 'function') {
    for (const [name, fn] of input as Iterable<[string, ActivityFunction]>) {
      assertActivity(name, fn)
      registry.set(name, fn)
    }
    return registry
  }

  Object.entries(input as Record<string, ActivityFunction>).forEach(([name, fn]) => {
    assertActivity(name, fn)
    registry.set(name, fn)
  })

  return registry
}

function assertActivity(name: string, fn: ActivityFunction): void {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`Invalid activity name: ${String(name)}`)
  }
  if (typeof fn !== 'function') {
    throw new Error(`Activity "${name}" must be a function`)
  }
}

function validateWorkerOptions(options: WorkerRuntimeOptions): void {
  if (!options.workflowsPath) {
    throw new Error('WorkerRuntime options require a workflowsPath')
  }
  if (!options.taskQueue) {
    throw new Error('WorkerRuntime options require a taskQueue')
  }
  if (!options.namespace && !options.clientOptions.namespace) {
    throw new Error('WorkerRuntime options require a namespace')
  }
  if (!options.clientOptions || !options.clientOptions.address) {
    throw new Error('WorkerRuntime options require clientOptions.address')
  }
  const workflowConcurrency = options.concurrency?.workflow ?? DEFAULT_WORKFLOW_CONCURRENCY
  const activityConcurrency = options.concurrency?.activity ?? DEFAULT_ACTIVITY_CONCURRENCY
  if (workflowConcurrency <= 0) {
    throw new Error('workflow concurrency must be greater than 0')
  }
  if (activityConcurrency <= 0) {
    throw new Error('activity concurrency must be greater than 0')
  }
}

async function settleWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  if (timeoutMs <= 0) {
    return await promise
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Worker shutdown timed out')), timeoutMs)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

async function wait(delayMs: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

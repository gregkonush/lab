import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export type WorkflowFunction = (...args: unknown[]) => unknown | Promise<unknown>

export interface WorkflowActivationJob {
  type: 'start' | 'signal' | 'shutdown'
  args?: unknown[]
  signalName?: string
}

export interface WorkflowActivation {
  taskToken: string
  runId: string
  workflowId: string
  workflowType: string
  job: WorkflowActivationJob
}

export interface SerializedWorkflowError {
  name?: string
  message: string
  stack?: string
}

export interface WorkflowCompletion {
  taskToken: string
  runId: string
  workflowId: string
  status: 'completed' | 'failed'
  result?: unknown
  error?: SerializedWorkflowError
}

interface WorkflowInstanceOptions {
  runId: string
  workflowId: string
  workflowType: string
  workflowFn: WorkflowFunction
}

class WorkflowInstance {
  #started = false
  #workflowFn: WorkflowFunction

  constructor(private readonly options: WorkflowInstanceOptions) {
    this.#workflowFn = options.workflowFn
  }

  async handle(job: WorkflowActivationJob): Promise<unknown> {
    switch (job.type) {
      case 'start':
        if (this.#started) {
          throw new Error(`Workflow run ${this.options.runId} already started`)
        }
        this.#started = true
        return await this.#workflowFn(...(job.args ?? []))
      case 'signal':
        throw new Error('Workflow signal handling is not implemented yet')
      case 'shutdown':
        return undefined
      default:
        throw new Error(`Unsupported workflow job type: ${(job as WorkflowActivationJob).type}`)
    }
  }

  get runId(): string {
    return this.options.runId
  }

  get workflowType(): string {
    return this.options.workflowType
  }
}

export class WorkflowIsolateManager {
  #workflowsPath: string
  #instances = new Map<string, WorkflowInstance>()
  #functionCache = new Map<string, WorkflowFunction>()

  constructor(workflowsPath: string) {
    this.#workflowsPath = workflowsPath
  }

  async execute(activation: WorkflowActivation): Promise<WorkflowCompletion> {
    const instance = await this.#getOrCreateInstance(activation)
    try {
      const result = await instance.handle(activation.job)
      const completion: WorkflowCompletion = {
        taskToken: activation.taskToken,
        runId: activation.runId,
        workflowId: activation.workflowId,
        status: 'completed',
        result,
      }
      if (activation.job.type !== 'signal') {
        this.#instances.delete(activation.runId)
      }
      return completion
    } catch (error) {
      this.#instances.delete(activation.runId)
      return {
        taskToken: activation.taskToken,
        runId: activation.runId,
        workflowId: activation.workflowId,
        status: 'failed',
        error: serializeWorkflowError(error),
      }
    }
  }

  async shutdown(): Promise<void> {
    this.#instances.clear()
    this.#functionCache.clear()
  }

  async #getOrCreateInstance(activation: WorkflowActivation): Promise<WorkflowInstance> {
    const existing = this.#instances.get(activation.runId)
    if (existing) {
      return existing
    }

    const workflowFn = await this.#loadWorkflowFunction(activation.workflowType)
    const instance = new WorkflowInstance({
      runId: activation.runId,
      workflowId: activation.workflowId,
      workflowType: activation.workflowType,
      workflowFn,
    })
    this.#instances.set(activation.runId, instance)
    return instance
  }

  async #loadWorkflowFunction(workflowType: string): Promise<WorkflowFunction> {
    const cached = this.#functionCache.get(workflowType)
    if (cached) {
      return cached
    }

    const moduleSpecifier = buildWorkflowSpecifier(this.#workflowsPath, workflowType)
    const mod = await import(moduleSpecifier)
    const fn = resolveWorkflowFunction(mod, workflowType)
    this.#functionCache.set(workflowType, fn)
    return fn
  }
}

const serializeWorkflowError = (error: unknown): SerializedWorkflowError => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    }
  }

  return {
    message: typeof error === 'string' ? error : JSON.stringify(error),
  }
}

const buildWorkflowSpecifier = (workflowsPath: string, workflowType: string): string => {
  const base = resolveSpecifier(workflowsPath)
  const separator = base.includes('?') ? '&' : '?'
  return `${base}${separator}workflow=${encodeURIComponent(workflowType)}`
}

const resolveSpecifier = (workflowsPath: string): string => {
  if (
    workflowsPath.startsWith('file:') ||
    workflowsPath.startsWith('http://') ||
    workflowsPath.startsWith('https://')
  ) {
    return workflowsPath
  }
  const absolute = isAbsolute(workflowsPath) ? workflowsPath : resolve(workflowsPath)
  return pathToFileURL(absolute).href
}

const resolveWorkflowFunction = (moduleExports: Record<string, unknown>, workflowType: string): WorkflowFunction => {
  const candidate = moduleExports[workflowType]
  if (typeof candidate === 'function') {
    return candidate as WorkflowFunction
  }

  if (moduleExports.default && typeof (moduleExports.default as Record<string, unknown>)[workflowType] === 'function') {
    return (moduleExports.default as Record<string, WorkflowFunction>)[workflowType]
  }

  throw new Error(`Workflow \"${workflowType}\" not found in loaded module`)
}

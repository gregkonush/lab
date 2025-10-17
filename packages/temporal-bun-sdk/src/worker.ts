import { loadTemporalConfig, type TemporalConfig } from './config'

export interface CreateWorkerOptions {
  config?: TemporalConfig
}

export interface WorkerHandle {
  readonly config: TemporalConfig
  stop(): Promise<void>
}

const notImplemented = () =>
  new Error(
    'Bun worker execution is not yet available in @proompteng/temporal-bun-sdk. Track progress in docs/troubleshooting.md.',
  )

export const createWorker = async (options: CreateWorkerOptions = {}): Promise<WorkerHandle> => {
  // Load configuration to validate env and surface errors early.
  await loadTemporalConfig({ defaults: options.config })
  throw notImplemented()
}

export const runWorker = async (_options: CreateWorkerOptions = {}): Promise<never> => {
  throw notImplemented()
}

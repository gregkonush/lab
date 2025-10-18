import { native, type Runtime as NativeRuntime } from '../internal/core-bridge/native.ts'
import { wrapNativeError } from './errors.ts'

const finalizeRuntime = (runtime: NativeRuntime): void => {
  try {
    native.runtimeShutdown(runtime)
  } catch {
    // Swallow errors during GC finalization to avoid process crashes.
  }
}

const runtimeFinalizer = new FinalizationRegistry<NativeRuntime>(finalizeRuntime)

export interface RuntimeOptions {
  nativeOptions?: Record<string, unknown>
}

export class TemporalRuntime {
  #native: NativeRuntime | undefined

  constructor(nativeRuntime: NativeRuntime) {
    this.#native = nativeRuntime
    runtimeFinalizer.register(this, nativeRuntime, this)
  }

  get handle(): number {
    return Number(this.#getNative().handle as unknown as number)
  }

  get native(): NativeRuntime {
    return this.#getNative()
  }

  get nativeHandle(): NativeRuntime {
    return this.#getNative()
  }

  async shutdown(): Promise<void> {
    if (!this.#native) return
    runtimeFinalizer.unregister(this)
    try {
      native.runtimeShutdown(this.#native)
    } catch (error) {
      throw wrapNativeError(error, 'Failed to shut down Temporal runtime')
    } finally {
      this.#native = undefined
    }
  }

  #getNative(): NativeRuntime {
    if (!this.#native) {
      throw new Error('Runtime has already been shut down')
    }
    return this.#native
  }
}

export const createRuntime = (options: RuntimeOptions = {}) => {
  try {
    const nativeRuntime = native.createRuntime(options.nativeOptions ?? {})
    return new TemporalRuntime(nativeRuntime)
  } catch (error) {
    throw wrapNativeError(error, 'Failed to create Temporal runtime')
  }
}

export const __TEST__ = {
  finalizeRuntime,
}

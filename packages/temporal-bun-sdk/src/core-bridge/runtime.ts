import { native, type Runtime as NativeRuntime } from '../internal/core-bridge/native.ts'

export interface RuntimeOptions {
  readonly options?: Record<string, unknown>
}

export class Runtime {
  #native: NativeRuntime | undefined

  static create(options: RuntimeOptions = {}): Runtime {
    return new Runtime(options)
  }

  private constructor(options: RuntimeOptions = {}) {
    this.#native = native.createRuntime(options.options ?? {})
    runtimeFinalizer.register(this, this.#native, this)
  }

  get nativeHandle(): NativeRuntime {
    if (!this.#native) {
      throw new Error('Runtime has already been shut down')
    }
    return this.#native
  }

  async shutdown(): Promise<void> {
    if (!this.#native) return
    native.runtimeShutdown(this.#native)
    runtimeFinalizer.unregister(this)
    this.#native = undefined
  }
}

const runtimeFinalizer = new FinalizationRegistry<NativeRuntime>((runtime) => {
  try {
    native.runtimeShutdown(runtime)
  } catch {
    // Swallow errors during GC finalization to avoid process crashes.
  }
})

export const createRuntime = (options: RuntimeOptions = {}): Runtime => Runtime.create(options)

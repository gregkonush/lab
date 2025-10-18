import {
  native,
  type LogLevelName,
  type NativeLogRecord,
  type Runtime as NativeRuntime,
} from '../internal/core-bridge/native.ts'

export interface RuntimeOptions {
  readonly options?: Record<string, unknown>
}

export interface RuntimeLogRecord {
  readonly level: number
  readonly levelName: LogLevelName
  readonly timestampMs: number
  readonly timestamp: Date
  readonly target: string
  readonly message: string
  readonly fields: Readonly<Record<string, unknown>>
  readonly spanContexts: readonly string[]
}

export type RuntimeLogger = (record: RuntimeLogRecord) => void

export class Runtime {
  #native: NativeRuntime | undefined
  #loggerTeardown?: () => void

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

  configureTelemetry(options: Record<string, unknown> = {}): never {
    // TODO(codex): Wire telemetry exporters through the native bridge once
    // `temporal_bun_runtime_update_telemetry` exists (see packages/temporal-bun-sdk/docs/ffi-surface.md).
    return native.configureTelemetry(this.nativeHandle, options)
  }

  installLogger(callback: RuntimeLogger): () => void {
    if (typeof callback !== 'function') {
      throw new TypeError('installLogger expects a function callback')
    }

    const nativeRuntime = this.nativeHandle

    if (this.#loggerTeardown) {
      this.#loggerTeardown()
      this.#loggerTeardown = undefined
    }

    let released = false

    const teardownNative = native.installLogger(nativeRuntime, (record: NativeLogRecord) => {
      callback(normalizeLogRecord(record))
    })

    const teardown = () => {
      if (released) {
        return
      }
      released = true
      teardownNative()
      if (this.#loggerTeardown === teardown) {
        this.#loggerTeardown = undefined
      }
    }

    this.#loggerTeardown = teardown
    return teardown
  }

  async shutdown(): Promise<void> {
    if (!this.#native) return
    const teardown = this.#loggerTeardown
    this.#loggerTeardown = undefined
    teardown?.()
    native.runtimeShutdown(this.#native)
    runtimeFinalizer.unregister(this)
    this.#native = undefined
  }
}

const finalizeRuntime = (runtime: NativeRuntime): void => {
  try {
    native.runtimeShutdown(runtime)
  } catch {
    // Swallow errors during GC finalization to avoid process crashes.
  }
}

const runtimeFinalizer = new FinalizationRegistry<NativeRuntime>(finalizeRuntime)

export const createRuntime = (options: RuntimeOptions = {}): Runtime => Runtime.create(options)

export const __TEST__ = {
  finalizeRuntime,
}

const normalizeLogRecord = (record: NativeLogRecord): RuntimeLogRecord => ({
  level: record.level,
  levelName: record.levelName,
  timestampMs: record.timestampMs,
  timestamp: new Date(record.timestampMs),
  target: record.target,
  message: record.message,
  fields: Object.freeze({ ...record.fields }),
  spanContexts: Object.freeze([...(record.spanContexts ?? [])]),
})

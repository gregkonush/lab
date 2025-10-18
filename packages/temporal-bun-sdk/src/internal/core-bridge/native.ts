import { JSCallback, dlopen, FFIType, ptr, toArrayBuffer } from 'bun:ffi'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Pointer = number

type RuntimePtr = Pointer

type ClientPtr = Pointer

export interface Runtime {
  type: 'runtime'
  handle: RuntimePtr
}

export interface NativeClient {
  type: 'client'
  handle: ClientPtr
}

const libraryFile = resolveBridgeLibraryPath()

const {
  symbols: {
    temporal_bun_runtime_new,
    temporal_bun_runtime_free,
    temporal_bun_runtime_set_logger,
    temporal_bun_runtime_emit_test_log,
    temporal_bun_log_record_free,
    temporal_bun_error_message,
    temporal_bun_error_free,
    temporal_bun_client_connect_async,
    temporal_bun_client_free,
    temporal_bun_client_describe_namespace_async,
    temporal_bun_pending_client_poll,
    temporal_bun_pending_client_consume,
    temporal_bun_pending_client_free,
    temporal_bun_pending_byte_array_poll,
    temporal_bun_pending_byte_array_consume,
    temporal_bun_pending_byte_array_free,
    temporal_bun_byte_array_free,
    temporal_bun_client_start_workflow,
  },
} = dlopen(libraryFile, {
  temporal_bun_runtime_new: {
    args: [FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.ptr,
  },
  temporal_bun_runtime_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  temporal_bun_runtime_set_logger: {
    args: [FFIType.ptr, FFIType.ptr],
    returns: FFIType.int32_t,
  },
  temporal_bun_runtime_emit_test_log: {
    args: [FFIType.ptr, FFIType.int32_t, FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.int32_t,
  },
  temporal_bun_log_record_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  temporal_bun_error_message: {
    args: [FFIType.ptr],
    returns: FFIType.ptr,
  },
  temporal_bun_error_free: {
    args: [FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.void,
  },
  temporal_bun_client_connect_async: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.ptr,
  },
  temporal_bun_client_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  temporal_bun_client_describe_namespace_async: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.ptr,
  },
  temporal_bun_pending_client_poll: {
    args: [FFIType.ptr],
    returns: FFIType.int32_t,
  },
  temporal_bun_pending_client_consume: {
    args: [FFIType.ptr],
    returns: FFIType.ptr,
  },
  temporal_bun_pending_client_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  temporal_bun_pending_byte_array_poll: {
    args: [FFIType.ptr],
    returns: FFIType.int32_t,
  },
  temporal_bun_pending_byte_array_consume: {
    args: [FFIType.ptr],
    returns: FFIType.ptr,
  },
  temporal_bun_pending_byte_array_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  temporal_bun_byte_array_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  temporal_bun_client_start_workflow: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.ptr,
  },
})

const runtimeLoggerCallbacks = new Map<number, JSCallback>()

const LOG_RECORD_BYTES = 80

type LogLevelName = 'trace' | 'debug' | 'info' | 'warn' | 'error'

export interface NativeLogRecord {
  level: number
  levelName: LogLevelName
  timestampMs: number
  target: string
  message: string
  fields: Record<string, unknown>
  spanContexts: string[]
}

type NativeLogHandler = (record: NativeLogRecord) => void

const levelNames: LogLevelName[] = ['trace', 'debug', 'info', 'warn', 'error']

function mapLevel(level: number): LogLevelName {
  return levelNames[level] ?? 'info'
}

function copyPointer(ptrValue: number, byteLength: number): Uint8Array {
  if (!ptrValue || byteLength === 0) {
    return new Uint8Array()
  }
  const view = new Uint8Array(toArrayBuffer(ptrValue, 0, byteLength))
  return new Uint8Array(view)
}

function decodeUtf8(bytes: Uint8Array): string {
  if (bytes.length === 0) {
    return ''
  }
  return Buffer.from(bytes).toString('utf8')
}

function parseJson<T>(bytes: Uint8Array, fallback: T): T {
  if (bytes.length === 0) {
    return fallback
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as T
  } catch {
    return fallback
  }
}

function decodeLogRecord(pointer: number): NativeLogRecord {
  const view = new DataView(toArrayBuffer(pointer, 0, LOG_RECORD_BYTES))

  const level = view.getInt32(0, true)
  const timestampMs = Number(view.getBigUint64(8, true))

  const targetPtr = Number(view.getBigUint64(16, true))
  const targetLen = Number(view.getBigUint64(24, true))
  const messagePtr = Number(view.getBigUint64(32, true))
  const messageLen = Number(view.getBigUint64(40, true))
  const fieldsPtr = Number(view.getBigUint64(48, true))
  const fieldsLen = Number(view.getBigUint64(56, true))
  const spansPtr = Number(view.getBigUint64(64, true))
  const spansLen = Number(view.getBigUint64(72, true))

  const target = decodeUtf8(copyPointer(targetPtr, targetLen))
  const message = decodeUtf8(copyPointer(messagePtr, messageLen))
  const fields = parseJson<Record<string, unknown>>(copyPointer(fieldsPtr, fieldsLen), {})
  const spanContexts = parseJson<string[]>(copyPointer(spansPtr, spansLen), [])

  return {
    level,
    levelName: mapLevel(level),
    timestampMs,
    target,
    message,
    fields,
    spanContexts,
  }
}

export const native = {
  createRuntime(options: Record<string, unknown> = {}): Runtime {
    const payload = Buffer.from(JSON.stringify(options), 'utf8')
    const handle = Number(temporal_bun_runtime_new(ptr(payload), payload.byteLength))
    if (!handle) {
      throw new Error(readLastError())
    }
    return { type: 'runtime', handle }
  },

  runtimeShutdown(runtime: Runtime): void {
    const existing = runtimeLoggerCallbacks.get(runtime.handle)
    if (existing) {
      runtimeLoggerCallbacks.delete(runtime.handle)
      temporal_bun_runtime_set_logger(runtime.handle, 0)
      existing.close()
    } else {
      temporal_bun_runtime_set_logger(runtime.handle, 0)
    }
    temporal_bun_runtime_free(runtime.handle)
  },

  async createClient(runtime: Runtime, config: Record<string, unknown>): Promise<NativeClient> {
    const payload = Buffer.from(JSON.stringify(config), 'utf8')
    const pendingHandle = Number(temporal_bun_client_connect_async(runtime.handle, ptr(payload), payload.byteLength))
    if (!pendingHandle) {
      throw new Error(readLastError())
    }
    try {
      const handle = await waitForClientHandle(pendingHandle)
      return { type: 'client', handle }
    } finally {
      temporal_bun_pending_client_free(pendingHandle)
    }
  },

  clientShutdown(client: NativeClient): void {
    temporal_bun_client_free(client.handle)
  },

  async describeNamespace(client: NativeClient, namespace: string): Promise<Uint8Array> {
    const payload = Buffer.from(JSON.stringify({ namespace }), 'utf8')
    const pendingHandle = Number(
      temporal_bun_client_describe_namespace_async(client.handle, ptr(payload), payload.byteLength),
    )
    if (!pendingHandle) {
      throw new Error(readLastError())
    }
    try {
      return await waitForByteArray(pendingHandle)
    } finally {
      temporal_bun_pending_byte_array_free(pendingHandle)
    }
  },

  async startWorkflow(client: NativeClient, request: Record<string, unknown>): Promise<Uint8Array> {
    const payload = Buffer.from(JSON.stringify(request), 'utf8')
    const arrayPtr = Number(temporal_bun_client_start_workflow(client.handle, ptr(payload), payload.byteLength))
    if (!arrayPtr) {
      throw new Error(readLastError())
    }
    return readByteArray(arrayPtr)
  },

  configureTelemetry(runtime: Runtime, options: Record<string, unknown> = {}): never {
    void runtime
    void options
    // TODO(codex): Bridge telemetry configuration through `temporal_bun_runtime_update_telemetry`
    // per packages/temporal-bun-sdk/docs/ffi-surface.md (Function Matrix, Runtime section).
    return notImplemented('Runtime telemetry configuration', 'docs/ffi-surface.md')
  },

  installLogger(runtime: Runtime, handler: NativeLogHandler): () => void {
    if (typeof handler !== 'function') {
      throw new TypeError('installLogger expects a function handler')
    }

    const existing = runtimeLoggerCallbacks.get(runtime.handle)
    if (existing) {
      runtimeLoggerCallbacks.delete(runtime.handle)
      temporal_bun_runtime_set_logger(runtime.handle, 0)
      existing.close()
    }

    const ffiCallback = new JSCallback(
      (recordPtr: number) => {
        if (!recordPtr) {
          return
        }

        const recordPointer = Number(recordPtr)

        let record: NativeLogRecord
        try {
          record = decodeLogRecord(recordPointer)
        } catch (error) {
          temporal_bun_log_record_free(recordPointer)
          throw error
        }

        try {
          queueMicrotask(() => {
            try {
              handler(record)
            } catch (error) {
              console.error('[temporal-bun-sdk] logger handler threw', error)
            } finally {
              temporal_bun_log_record_free(recordPointer)
            }
          })
        } catch (error) {
          temporal_bun_log_record_free(recordPointer)
          throw error
        }
      },
      {
        args: [FFIType.ptr],
        returns: FFIType.void,
        threads: true,
      },
    )

    runtimeLoggerCallbacks.set(runtime.handle, ffiCallback)

    const status = Number(temporal_bun_runtime_set_logger(runtime.handle, ffiCallback.ptr))
    if (status !== 0) {
      runtimeLoggerCallbacks.delete(runtime.handle)
      ffiCallback.close()
      throw new Error(readLastError())
    }

    let active = true

    return () => {
      if (!active) {
        return
      }
      active = false
      const current = runtimeLoggerCallbacks.get(runtime.handle)
      if (current === ffiCallback) {
        runtimeLoggerCallbacks.delete(runtime.handle)
        const resetStatus = Number(temporal_bun_runtime_set_logger(runtime.handle, 0))
        if (resetStatus !== 0) {
          console.warn('[temporal-bun-sdk] failed to clear native logger callback:', readLastError())
        }
      }
      ffiCallback.close()
    }
  },

  // test-only helper used by Bun unit tests to trigger a core log entry.
  emitTestLog(runtime: Runtime, level: number, message: string): void {
    const buffer = Buffer.from(message, 'utf8')
    const pointer = buffer.byteLength > 0 ? ptr(buffer) : 0
    const status = Number(temporal_bun_runtime_emit_test_log(runtime.handle, level, pointer, buffer.byteLength))
    if (status !== 0) {
      throw new Error(readLastError())
    }
  },

  updateClientHeaders(client: NativeClient, _headers: Record<string, string>): never {
    void client
    // TODO(codex): Expose metadata mutation via `temporal_bun_client_update_headers` as outlined in
    // docs/ffi-surface.md (Client exports) to support API key rotation and custom headers.
    return notImplemented('Client metadata updates', 'docs/ffi-surface.md')
  },

  async signalWorkflow(client: NativeClient, _request: Record<string, unknown>): Promise<never> {
    void client
    void _request
    // TODO(codex): Call into `temporal_bun_client_signal` once implemented to deliver workflow signals
    // per the packages/temporal-bun-sdk/docs/ffi-surface.md function matrix.
    return Promise.reject(buildNotImplementedError('Workflow signal bridge', 'docs/ffi-surface.md'))
  },

  async queryWorkflow(client: NativeClient, _request: Record<string, unknown>): Promise<never> {
    void client
    void _request
    // TODO(codex): Marshal workflow queries through `temporal_bun_client_query` once the native bridge
    // is available (docs/ffi-surface.md — Client exports).
    return Promise.reject(buildNotImplementedError('Workflow query bridge', 'docs/ffi-surface.md'))
  },

  async terminateWorkflow(client: NativeClient, _request: Record<string, unknown>): Promise<never> {
    void client
    void _request
    // TODO(codex): Implement termination via `temporal_bun_client_terminate_workflow` per the native
    // bridge plan documented in docs/ffi-surface.md.
    return Promise.reject(buildNotImplementedError('Workflow termination bridge', 'docs/ffi-surface.md'))
  },

  async cancelWorkflow(client: NativeClient, _request: Record<string, unknown>): Promise<never> {
    void client
    void _request
    // TODO(codex): Route cancellations through `temporal_bun_client_cancel_workflow` when the FFI export
    // exists (docs/ffi-surface.md).
    return Promise.reject(buildNotImplementedError('Workflow cancel bridge', 'docs/ffi-surface.md'))
  },

  async signalWithStart(client: NativeClient, _request: Record<string, unknown>): Promise<never> {
    void client
    void _request
    // TODO(codex): Implement signal-with-start via `temporal_bun_client_signal_with_start` following the
    // parity checklist in docs/ffi-surface.md and docs/client-runtime.md.
    return Promise.reject(buildNotImplementedError('Signal-with-start bridge', 'docs/ffi-surface.md'))
  },
}

function resolveBridgeLibraryPath(): string {
  const override = process.env.TEMPORAL_BUN_SDK_NATIVE_PATH
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`Temporal Bun bridge override not found at ${override}`)
    }
    return override
  }

  const targetDir = fileURLToPath(new URL('../../../native/temporal-bun-bridge/target', import.meta.url))
  const baseName =
    process.platform === 'win32'
      ? 'temporal_bun_bridge.dll'
      : process.platform === 'darwin'
        ? 'libtemporal_bun_bridge.dylib'
        : 'libtemporal_bun_bridge.so'

  const releasePath = join(targetDir, 'release', baseName)
  if (existsSync(releasePath)) {
    return releasePath
  }

  const debugPath = join(targetDir, 'debug', baseName)
  if (existsSync(debugPath)) {
    return debugPath
  }

  const depsDir = join(targetDir, 'debug', 'deps')
  if (existsSync(depsDir)) {
    const prefix = baseName.replace(/\.[^./]+$/, '')
    const candidate = readdirSync(depsDir)
      .filter((file) => file.startsWith(prefix))
      .map((file) => join(depsDir, file))
      .find((file) => existsSync(file))
    if (candidate) {
      return candidate
    }
  }

  throw new Error(
    `Temporal Bun bridge library not found. Expected at ${releasePath} or ${debugPath}. Did you build the native bridge?`,
  )
}

function readByteArray(pointer: number): Uint8Array {
  const header = new BigUint64Array(toArrayBuffer(pointer, 0, 24))
  const dataPtr = Number(header[0])
  const len = Number(header[1])
  const view = new Uint8Array(toArrayBuffer(dataPtr, 0, len))
  // Copy into JS-owned memory before the native buffer is released.
  const copy = new Uint8Array(view)
  temporal_bun_byte_array_free(pointer)
  return copy
}

async function waitForClientHandle(handle: number): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const poll = (): void => {
      const status = Number(temporal_bun_pending_client_poll(handle))
      if (status === 0) {
        setTimeout(poll, 0)
        return
      }

      if (status === 1) {
        try {
          const pointer = Number(temporal_bun_pending_client_consume(handle))
          if (!pointer) {
            throw new Error(readLastError())
          }
          resolve(pointer)
        } catch (error) {
          reject(error)
        }
        return
      }

      reject(new Error(readLastError()))
    }

    setTimeout(poll, 0)
  })
}

async function waitForByteArray(handle: number): Promise<Uint8Array> {
  return await new Promise<Uint8Array>((resolve, reject) => {
    const poll = (): void => {
      const status = Number(temporal_bun_pending_byte_array_poll(handle))
      if (status === 0) {
        setTimeout(poll, 0)
        return
      }

      if (status === 1) {
        try {
          const arrayPtr = Number(temporal_bun_pending_byte_array_consume(handle))
          if (!arrayPtr) {
            throw new Error(readLastError())
          }
          resolve(readByteArray(arrayPtr))
        } catch (error) {
          reject(error)
        }
        return
      }

      // status === -1 or unexpected
      reject(new Error(readLastError()))
    }

    setTimeout(poll, 0)
  })
}

function readLastError(): string {
  const lenBuffer = new BigUint64Array(1)
  const errPtr = Number(temporal_bun_error_message(ptr(lenBuffer)))
  const len = Number(lenBuffer[0])
  if (!errPtr || len === 0) {
    return 'Unknown native error'
  }
  try {
    const buffer = Buffer.from(toArrayBuffer(errPtr, 0, len))
    return buffer.toString('utf8')
  } finally {
    temporal_bun_error_free(errPtr, len)
  }
}

function buildNotImplementedError(feature: string, docPath: string): Error {
  return new Error(
    `${feature} is not implemented yet. See packages/temporal-bun-sdk/${docPath} for the implementation plan.`,
  )
}

function notImplemented(feature: string, docPath: string): never {
  throw buildNotImplementedError(feature, docPath)
}

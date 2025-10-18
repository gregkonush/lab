import { dlopen, FFIType, ptr, toArrayBuffer } from 'bun:ffi'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NativeClient, Runtime } from '../core-bridge/native.ts'

type Pointer = number

type WorkerPtr = Pointer

interface WorkerBindingSymbols {
  temporal_bun_worker_new: (runtimePtr: Pointer, clientPtr: Pointer, payloadPtr: Pointer, payloadLen: number) => Pointer
  temporal_bun_worker_free: (workerPtr: Pointer) => void
  temporal_bun_worker_poll_workflow_task: (workerPtr: Pointer) => Pointer
  temporal_bun_worker_complete_workflow_task: (workerPtr: Pointer, payloadPtr: Pointer, payloadLen: number) => number
  temporal_bun_worker_poll_activity_task: (workerPtr: Pointer) => Pointer
  temporal_bun_worker_complete_activity_task: (workerPtr: Pointer, payloadPtr: Pointer, payloadLen: number) => number
  temporal_bun_worker_record_activity_heartbeat: (workerPtr: Pointer, payloadPtr: Pointer, payloadLen: number) => number
  temporal_bun_worker_initiate_shutdown: (workerPtr: Pointer) => number
  temporal_bun_worker_finalize_shutdown: (workerPtr: Pointer) => number
  temporal_bun_error_message: (lenOutPtr: Pointer) => Pointer
  temporal_bun_error_free: (ptr: Pointer, len: number) => void
  temporal_bun_byte_array_free: (ptr: Pointer) => void
}

export interface NativeWorker {
  type: 'worker'
  handle: WorkerPtr
}

const libraryPath = resolveBridgeLibraryPath()

let workerSymbols: WorkerBindingSymbols | null = null
let loadFailure: Error | null = null

try {
  const { symbols } = dlopen(libraryPath, {
    temporal_bun_worker_new: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
      returns: FFIType.ptr,
    },
    temporal_bun_worker_free: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
    temporal_bun_worker_poll_workflow_task: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    temporal_bun_worker_complete_workflow_task: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
      returns: FFIType.int32_t,
    },
    temporal_bun_worker_poll_activity_task: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    temporal_bun_worker_complete_activity_task: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
      returns: FFIType.int32_t,
    },
    temporal_bun_worker_record_activity_heartbeat: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
      returns: FFIType.int32_t,
    },
    temporal_bun_worker_initiate_shutdown: {
      args: [FFIType.ptr],
      returns: FFIType.int32_t,
    },
    temporal_bun_worker_finalize_shutdown: {
      args: [FFIType.ptr],
      returns: FFIType.int32_t,
    },
    temporal_bun_error_message: {
      args: [FFIType.ptr],
      returns: FFIType.ptr,
    },
    temporal_bun_error_free: {
      args: [FFIType.ptr, FFIType.uint64_t],
      returns: FFIType.void,
    },
    temporal_bun_byte_array_free: {
      args: [FFIType.ptr],
      returns: FFIType.void,
    },
  })

  workerSymbols = symbols as WorkerBindingSymbols
} catch (error) {
  loadFailure = error instanceof Error ? error : new Error(String(error))
}

export const native = {
  get hasWorkerBindings(): boolean {
    return workerSymbols !== null
  },

  createWorker(runtime: Runtime, client: NativeClient, config: Record<string, unknown>): NativeWorker {
    const symbols = ensureSymbols()
    const payload = encodePayload(config)
    const handle = Number(
      symbols.temporal_bun_worker_new(runtime.handle, client.handle, ptr(payload), payload.byteLength),
    )
    if (!handle) {
      throw new Error(readLastError(symbols))
    }
    return { type: 'worker', handle }
  },

  workerShutdown(worker: NativeWorker): void {
    const symbols = ensureSymbols()
    try {
      symbols.temporal_bun_worker_free(worker.handle)
    } catch (error) {
      throw formatNativeError(error)
    }
  },

  pollWorkflowTask(worker: NativeWorker): Uint8Array | null {
    const symbols = ensureSymbols()
    const pointer = Number(symbols.temporal_bun_worker_poll_workflow_task(worker.handle))
    if (!pointer) {
      const message = readLastError(symbols)
      if (message === 'Unknown native error') {
        return null
      }
      throw new Error(message)
    }
    return readByteArray(symbols, pointer)
  },

  completeWorkflowTask(worker: NativeWorker, payload: PayloadInput): void {
    const symbols = ensureSymbols()
    const buffer = encodePayload(payload)
    const status = Number(
      symbols.temporal_bun_worker_complete_workflow_task(worker.handle, ptr(buffer), buffer.byteLength),
    )
    if (status !== 0) {
      throw new Error(readLastError(symbols))
    }
  },

  pollActivityTask(worker: NativeWorker): Uint8Array | null {
    const symbols = ensureSymbols()
    const pointer = Number(symbols.temporal_bun_worker_poll_activity_task(worker.handle))
    if (!pointer) {
      const message = readLastError(symbols)
      if (message === 'Unknown native error') {
        return null
      }
      throw new Error(message)
    }
    return readByteArray(symbols, pointer)
  },

  completeActivityTask(worker: NativeWorker, payload: PayloadInput): void {
    const symbols = ensureSymbols()
    const buffer = encodePayload(payload)
    const status = Number(
      symbols.temporal_bun_worker_complete_activity_task(worker.handle, ptr(buffer), buffer.byteLength),
    )
    if (status !== 0) {
      throw new Error(readLastError(symbols))
    }
  },

  recordActivityHeartbeat(worker: NativeWorker, payload: PayloadInput): void {
    const symbols = ensureSymbols()
    const buffer = encodePayload(payload)
    const status = Number(
      symbols.temporal_bun_worker_record_activity_heartbeat(worker.handle, ptr(buffer), buffer.byteLength),
    )
    if (status !== 0) {
      throw new Error(readLastError(symbols))
    }
  },

  initiateShutdown(worker: NativeWorker): void {
    const symbols = ensureSymbols()
    const status = Number(symbols.temporal_bun_worker_initiate_shutdown(worker.handle))
    if (status !== 0) {
      throw new Error(readLastError(symbols))
    }
  },

  finalizeShutdown(worker: NativeWorker): void {
    const symbols = ensureSymbols()
    const status = Number(symbols.temporal_bun_worker_finalize_shutdown(worker.handle))
    if (status !== 0) {
      throw new Error(readLastError(symbols))
    }
  },
}

type PayloadInput = Uint8Array | ArrayBuffer | ArrayBufferView | Record<string, unknown> | readonly unknown[]

function encodePayload(payload: PayloadInput): Buffer {
  if (payload instanceof Uint8Array) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
  }
  if (payload instanceof ArrayBuffer) {
    return Buffer.from(payload)
  }
  if (ArrayBuffer.isView(payload)) {
    return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength)
  }
  return Buffer.from(JSON.stringify(payload), 'utf8')
}

function readByteArray(symbols: WorkerBindingSymbols, pointer: number): Uint8Array {
  const header = new BigUint64Array(toArrayBuffer(pointer, 0, 24))
  const dataPtr = Number(header[0])
  const len = Number(header[1])
  if (!dataPtr || !len) {
    symbols.temporal_bun_byte_array_free(pointer)
    return new Uint8Array(0)
  }
  const view = new Uint8Array(toArrayBuffer(dataPtr, 0, len))
  const copy = new Uint8Array(view)
  symbols.temporal_bun_byte_array_free(pointer)
  return copy
}

function readLastError(symbols: WorkerBindingSymbols): string {
  const lenBuffer = new BigUint64Array(1)
  const errPtr = Number(symbols.temporal_bun_error_message(ptr(lenBuffer)))
  const len = Number(lenBuffer[0])
  if (!errPtr || len === 0) {
    return 'Unknown native error'
  }
  try {
    const buffer = Buffer.from(toArrayBuffer(errPtr, 0, len))
    return buffer.toString('utf8')
  } finally {
    symbols.temporal_bun_error_free(errPtr, len)
  }
}

function ensureSymbols(): WorkerBindingSymbols {
  if (!workerSymbols) {
    throw buildLoadError()
  }
  return workerSymbols
}

function buildLoadError(): Error {
  const base =
    'Temporal Bun worker native bindings are unavailable. Ensure the native bridge exposes worker symbols per packages/temporal-bun-sdk/docs/ffi-surface.md.'
  if (!loadFailure) {
    return new Error(base)
  }
  return new Error(`${base} Loader error: ${loadFailure.message}`)
}

function formatNativeError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  return new Error(String(error))
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

import { dlopen, FFIType, ptr, toArrayBuffer } from 'bun:ffi'
import { existsSync } from 'node:fs'
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
    temporal_bun_error_message,
    temporal_bun_error_free,
    temporal_bun_client_connect,
    temporal_bun_client_free,
    temporal_bun_client_describe_namespace,
    temporal_bun_client_start_workflow,
    temporal_bun_byte_array_free,
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
  temporal_bun_error_message: {
    args: [FFIType.ptr],
    returns: FFIType.ptr,
  },
  temporal_bun_error_free: {
    args: [FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.void,
  },
  temporal_bun_client_connect: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.ptr,
  },
  temporal_bun_client_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
  temporal_bun_client_describe_namespace: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.ptr,
  },
  temporal_bun_client_start_workflow: {
    args: [FFIType.ptr, FFIType.ptr, FFIType.uint64_t],
    returns: FFIType.ptr,
  },
  temporal_bun_byte_array_free: {
    args: [FFIType.ptr],
    returns: FFIType.void,
  },
})

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
    temporal_bun_runtime_free(runtime.handle as Pointer)
  },

  createClient(runtime: Runtime, config: Record<string, unknown>): NativeClient {
    const payload = Buffer.from(JSON.stringify(config), 'utf8')
    const handle = Number(temporal_bun_client_connect(runtime.handle as Pointer, ptr(payload), payload.byteLength))
    if (!handle) {
      throw new Error(readLastError())
    }
    return { type: 'client', handle }
  },

  clientShutdown(client: NativeClient): void {
    temporal_bun_client_free(client.handle as Pointer)
  },

  describeNamespace(client: NativeClient, namespace: string): Uint8Array {
    const payload = Buffer.from(JSON.stringify({ namespace }), 'utf8')
    const arrayPtr = Number(
      temporal_bun_client_describe_namespace(client.handle as Pointer, ptr(payload), payload.byteLength),
    )
    if (!arrayPtr) {
      throw new Error(readLastError())
    }
    return readByteArray(arrayPtr)
  },

  startWorkflow(client: NativeClient, request: Record<string, unknown>): Uint8Array {
    const payload = Buffer.from(JSON.stringify(request), 'utf8')
    const arrayPtr = Number(
      temporal_bun_client_start_workflow(client.handle as Pointer, ptr(payload), payload.byteLength),
    )
    if (!arrayPtr) {
      throw new Error(readLastError())
    }
    return readByteArray(arrayPtr)
  },
}

function resolveBridgeLibraryPath(): string {
  const dir = fileURLToPath(new URL('../../../native/temporal-bun-bridge/target/release', import.meta.url))
  const baseName =
    process.platform === 'win32'
      ? 'temporal_bun_bridge.dll'
      : process.platform === 'darwin'
        ? 'libtemporal_bun_bridge.dylib'
        : 'libtemporal_bun_bridge.so'
  const candidate = join(dir, baseName)
  if (!existsSync(candidate)) {
    throw new Error(`Temporal Bun bridge library not found at ${candidate}. Did you build the native bridge?`)
  }
  return candidate
}

function readByteArray(pointer: number): Uint8Array {
  const header = new BigUint64Array(toArrayBuffer(pointer, 0, 24))
  const dataPtr = Number(header[0])
  const len = Number(header[1])
  const view = new Uint8Array(toArrayBuffer(dataPtr, 0, len))
  // Copy into JS-owned memory before the native buffer is released.
  const copy = new Uint8Array(view)
  temporal_bun_byte_array_free(pointer as Pointer)
  return copy
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
    temporal_bun_error_free(errPtr as Pointer, len)
  }
}

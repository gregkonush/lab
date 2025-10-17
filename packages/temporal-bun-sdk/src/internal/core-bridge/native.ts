import { dlopen, FFIType, ptr, toArrayBuffer, type Pointer } from 'bun:ffi'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Runtime {
  type: 'runtime'
  handle: Pointer
}

export interface NativeClient {
  type: 'client'
  handle: Pointer
}

export interface CreateClientConfig {
  address: string
  namespace: string
  identity?: string
  clientName?: string
  clientVersion?: string
  apiKey?: string
  tls?: {
    serverRootCACertificate?: string
    clientCertPair?: {
      crt: string
      key: string
    }
    serverNameOverride?: string
  }
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
})

export const native = {
  createRuntime(options: Record<string, unknown> = {}): Runtime {
    const payload = Buffer.from(JSON.stringify(options), 'utf8')
    const handle = temporal_bun_runtime_new(ptr(payload), payload.byteLength) as Pointer
    if (Number(handle) === 0) {
      throw new Error(readLastError())
    }
    return { type: 'runtime', handle }
  },

  runtimeShutdown(runtime: Runtime): void {
    temporal_bun_runtime_free(runtime.handle)
  },

  createClient(runtime: Runtime, config: CreateClientConfig): NativeClient {
    const payload = Buffer.from(JSON.stringify(config), 'utf8')
    const handle = temporal_bun_client_connect(runtime.handle, ptr(payload), payload.byteLength) as Pointer
    if (Number(handle) === 0) {
      throw new Error(readLastError())
    }
    return { type: 'client', handle }
  },

  clientShutdown(client: NativeClient): void {
    temporal_bun_client_free(client.handle)
  },
}

function resolveBridgeLibraryPath(): string {
  const developmentDir = fileURLToPath(new URL('../../../native/temporal-bun-bridge/target/release', import.meta.url))
  const packagedDir = fileURLToPath(new URL('../../../dist/native', import.meta.url))
  const baseName =
    process.platform === 'win32'
      ? 'temporal_bun_bridge.dll'
      : process.platform === 'darwin'
        ? 'libtemporal_bun_bridge.dylib'
        : 'libtemporal_bun_bridge.so'
  const candidates = [join(developmentDir, baseName), join(packagedDir, baseName)]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(
    `Temporal Bun bridge library not found in ${candidates.join(
      ', ',
    )}. Build the bridge with \"pnpm --filter @proompteng/temporal-bun-sdk run build:native\".`,
  )
}

function readLastError(): string {
  const lenBuffer = new BigUint64Array(1)
  const errPtr = temporal_bun_error_message(ptr(lenBuffer)) as Pointer
  const len = Number(lenBuffer[0])
  if (Number(errPtr) === 0 || len === 0) {
    return 'Unknown native error'
  }
  try {
    const buffer = Buffer.from(toArrayBuffer(errPtr, 0, len))
    return buffer.toString('utf8')
  } finally {
    temporal_bun_error_free(errPtr, len)
  }
}

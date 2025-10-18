import type { Runtime } from './runtime.ts'
import { native, type NativeClient } from '../internal/core-bridge/native.ts'

export interface ClientOptions {
  readonly address: string
  readonly namespace: string
  readonly identity?: string
  readonly clientName?: string
  readonly clientVersion?: string
}

export class Client {
  #native: NativeClient | undefined
  readonly namespace: string

  static async connect(runtime: Runtime, options: ClientOptions): Promise<Client> {
    const client = new Client(runtime, options)
    await client.#init()
    return client
  }

  private constructor(
    private readonly runtime: Runtime,
    private readonly options: ClientOptions,
  ) {
    this.namespace = options.namespace
  }

  async #init(): Promise<void> {
    const nativeRuntime = this.runtime.nativeHandle
    this.#native = await native.createClient(nativeRuntime, {
      address: normalizeTemporalAddress(this.options.address),
      namespace: this.options.namespace,
      identity: this.options.identity,
      client_name: this.options.clientName,
      client_version: this.options.clientVersion,
    })
    clientFinalizer.register(this, this.#native, this)
  }

  get nativeHandle(): NativeClient {
    if (!this.#native) {
      throw new Error('Client has already been shut down')
    }
    return this.#native
  }

  async describeNamespace(namespace = this.namespace): Promise<Uint8Array> {
    const handle = this.nativeHandle
    return await native.describeNamespace(handle, namespace)
  }

  async shutdown(): Promise<void> {
    if (!this.#native) return
    native.clientShutdown(this.#native)
    clientFinalizer.unregister(this)
    this.#native = undefined
  }
}

export const createClient = async (runtime: Runtime, options: ClientOptions): Promise<Client> => {
  return await Client.connect(runtime, options)
}

const clientFinalizer = new FinalizationRegistry<NativeClient>((client) => {
  try {
    native.clientShutdown(client)
  } catch {
    // Best-effort cleanup; ignore errors during GC finalization.
  }
})

const ADDRESS_WITH_PROTOCOL = /^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//

export const normalizeTemporalAddress = (address: string): string => {
  if (ADDRESS_WITH_PROTOCOL.test(address)) {
    return address
  }
  return `http://${address}`
}

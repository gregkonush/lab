export interface TemporalBridgeErrorOptions {
  code?: string
  details?: unknown
  retryable?: boolean
  cause?: unknown
}

export class TemporalBridgeError extends Error {
  readonly code?: string
  readonly details?: unknown
  readonly retryable: boolean

  constructor(message: string, options: TemporalBridgeErrorOptions = {}) {
    super(message, { cause: options.cause })
    this.name = 'TemporalBridgeError'
    this.code = options.code
    this.details = options.details
    this.retryable = options.retryable ?? false
  }
}

export const wrapNativeError = (error: unknown, context: string) => {
  if (error instanceof TemporalBridgeError) {
    return error
  }

  if (error instanceof Error) {
    return new TemporalBridgeError(`${context}: ${error.message}`, { cause: error })
  }

  return new TemporalBridgeError(`${context}: ${String(error)}`)
}

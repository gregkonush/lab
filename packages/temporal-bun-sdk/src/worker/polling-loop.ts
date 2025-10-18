const DEFAULT_IDLE_DELAY_MS = 10

export interface PollingLoopOptions<T> {
  signal: AbortSignal
  poll: () => Promise<T | null> | T | null
  handler: (value: T) => Promise<void> | void
  onError?: (error: unknown) => void
  idleDelayMs?: number
}

export const createPollingLoop = async <T>(options: PollingLoopOptions<T>): Promise<void> => {
  const { signal, poll, handler, onError, idleDelayMs = DEFAULT_IDLE_DELAY_MS } = options

  while (!signal.aborted) {
    try {
      const value = await poll()
      if (signal.aborted) {
        break
      }

      if (value == null) {
        if (idleDelayMs > 0) {
          await wait(idleDelayMs)
        }
        continue
      }

      await handler(value)
    } catch (error) {
      if (signal.aborted) {
        break
      }
      onError?.(error)
      if (idleDelayMs > 0) {
        await wait(idleDelayMs)
      }
    }
  }
}

const wait = async (delayMs: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, delayMs))
}

import { describe, expect, test } from 'bun:test'

import { NodeRedis } from '@effect/platform-node'
import { ConfigProvider, Effect, Fiber, Layer, Option, Result } from 'effect'
import { createClient } from 'redis'

import { makeValkeyCache, ValkeyCache, ValkeyCacheError, ValkeyCacheInputError, ValkeyCacheLive } from './valkey-cache'

const rejectedInput = async (
  operation: (
    cache: Effect.Success<typeof makeValkeyCache>,
  ) => Effect.Effect<unknown, ValkeyCacheError | ValkeyCacheInputError>,
) => {
  const options: Parameters<typeof createClient>[0] = {
    socket: { host: '127.0.0.1', port: 1, reconnectStrategy: false },
  }
  const client = createClient(options)
  const result = await Effect.gen(function* () {
    const cache = yield* makeValkeyCache
    return yield* operation(cache)
  }).pipe(
    Effect.provideService(NodeRedis.NodeRedis, { client, use: () => Effect.die('unexpected generic client use') }),
    Effect.scoped,
    Effect.result,
    Effect.runPromise,
  )
  expect(client.isOpen).toBe(false)
  expect(Result.isFailure(result)).toBe(true)
  if (Result.isFailure(result)) {
    expect(result.failure).toBeInstanceOf(ValkeyCacheInputError)
    return result.failure
  }
  throw new Error('Expected invalid cache input to fail before connecting')
}

describe('Valkey cache trust boundary', () => {
  test('missing optional cache configuration is a typed availability failure', async () => {
    const result = await Effect.void.pipe(
      Effect.provide(ValkeyCacheLive),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
      Effect.result,
      Effect.runPromise,
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ValkeyCacheError)
      expect(result.failure.operation).toBe('configure')
    }
  })

  test('rejects foreign and empty namespaces before opening a socket', async () => {
    for (const key of ['other:private', 'bayn:', 'bayn:\n']) {
      const error = await rejectedInput((cache) => cache.get(key))
      expect(error.operation).toBe('get')
      expect(error.message).not.toContain('other:private')
    }
  })

  test('rejects deletion outside the application namespace', async () => {
    const error = await rejectedInput((cache) => cache.remove('other:private'))
    expect(error.operation).toBe('remove')
  })

  test('requires a finite positive bounded expiry for every write', async () => {
    for (const ttlMs of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 300_001]) {
      const error = await rejectedInput((cache) => cache.put({ key: 'bayn:test', value: 'private-value', ttlMs }))
      expect(error.operation).toBe('put')
      expect(error.message).not.toContain('private-value')
    }
  })

  test('rejects oversized values before opening a socket', async () => {
    const error = await rejectedInput((cache) =>
      cache.put({ key: 'bayn:test', value: 'x'.repeat(262_145), ttlMs: 1000 }),
    )
    expect(error.operation).toBe('put')
  })
})

const transportFixture = async (mode: 'miss' | 'hold' | 'error') => {
  const { createServer } = await import('node:net')
  const received = Promise.withResolvers<void>()
  const closed = Promise.withResolvers<void>()
  let closes = 0
  const server = createServer((socket) => {
    let buffer = ''
    socket.on('data', (data) => {
      buffer += data.toString()
      while (buffer.length > 0) {
        const head = buffer.indexOf('\r\n')
        if (head < 0) return
        const count = Number(buffer.slice(1, head))
        const args: string[] = []
        let offset = head + 2
        for (let i = 0; i < count; i++) {
          const end = buffer.indexOf('\r\n', offset)
          if (end < 0) return
          const length = Number(buffer.slice(offset + 1, end))
          if (buffer.length < end + 2 + length + 2) return
          args.push(buffer.slice(end + 2, end + 2 + length))
          offset = end + 2 + length + 2
        }
        buffer = buffer.slice(offset)
        if (args[0]?.toUpperCase() === 'CLIENT') socket.write('+OK\r\n')
        else if (args[0]?.toUpperCase() === 'GET') {
          received.resolve()
          if (mode === 'miss') socket.write('$-1\r\n')
          if (mode === 'error') socket.write('-WRONGTYPE fixture\r\n')
        } else socket.write('-ERR unsupported fixture command\r\n')
      }
    })
    socket.on('close', () => {
      closes++
      closed.resolve()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP test listener')
  return {
    received: received.promise,
    closed: closed.promise,
    closes: () => closes,
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    layer: Layer.effect(ValkeyCache, makeValkeyCache).pipe(
      Layer.provide(
        NodeRedis.layer({
          RESP: 2,
          disableOfflineQueue: true,
          socket: { host: '127.0.0.1', port: address.port, reconnectStrategy: false, connectTimeout: 100 },
        }),
      ),
    ),
  }
}

describe('Valkey cache transport lifecycle', () => {
  test('returns a miss and closes its scoped connection exactly once', async () => {
    const fixture = await transportFixture('miss')
    try {
      const result = await Effect.gen(function* () {
        const cache = yield* ValkeyCache
        return yield* cache.get('bayn:test')
      }).pipe(Effect.provide(fixture.layer), Effect.runPromise)
      expect(Option.isNone(result)).toBe(true)
      await fixture.closed
      expect(fixture.closes()).toBe(1)
    } finally {
      await fixture.stop()
    }
  })

  test('retains transport failure context without treating it as a miss', async () => {
    const fixture = await transportFixture('error')
    try {
      const result = await Effect.gen(function* () {
        const cache = yield* ValkeyCache
        return yield* cache.get('bayn:test')
      }).pipe(Effect.provide(fixture.layer), Effect.result, Effect.runPromise)
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ValkeyCacheError)
      await fixture.closed
      expect(fixture.closes()).toBe(1)
    } finally {
      await fixture.stop()
    }
  })

  test('destroys an in-flight transport on deadline instead of leaving it running', async () => {
    const fixture = await transportFixture('hold')
    try {
      const result = await Effect.gen(function* () {
        const cache = yield* ValkeyCache
        return yield* cache.get('bayn:test')
      }).pipe(Effect.provide(fixture.layer), Effect.result, Effect.runPromise)
      await fixture.received
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result)) expect(result.failure.message).toContain('deadline')
      await fixture.closed
      expect(fixture.closes()).toBe(1)
    } finally {
      await fixture.stop()
    }
  })

  test('caller interruption destroys the in-flight connection', async () => {
    const fixture = await transportFixture('hold')
    try {
      await Effect.gen(function* () {
        const cache = yield* ValkeyCache
        const fiber = yield* Effect.forkScoped(cache.get('bayn:test'))
        yield* Effect.promise(() => fixture.received)
        yield* Fiber.interrupt(fiber)
      }).pipe(Effect.scoped, Effect.provide(fixture.layer), Effect.runPromise)
      await fixture.closed
      expect(fixture.closes()).toBe(1)
    } finally {
      await fixture.stop()
    }
  })
})

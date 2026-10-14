import { describe, expect, test } from 'bun:test'
import { NodeRedis } from '@effect/platform-node'
import { ConfigProvider, Effect, Fiber, Layer, Option, Result } from 'effect'

import { makeValkeyCache, ValkeyCache, ValkeyCacheError, ValkeyCacheInputError, ValkeyCacheLive } from './valkey-cache'

const transportFixture = async (
  mode: 'miss' | 'hold' | 'error' | 'handshake-hold' | 'write' | 'unreplicated' | 'delayed-replica' | 'replica-timeout',
) => {
  const { createServer } = await import('node:net')
  let response = mode
  const received = Promise.withResolvers<void>()
  let closed = Promise.withResolvers<void>()
  let closes = 0
  let writes = 0
  const waits: string[][] = []
  const values = new Map<string, string>()
  const server = createServer((socket) => {
    const connectionClosed = Promise.withResolvers<void>()
    closed = connectionClosed
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
        if (args[0]?.toUpperCase() === 'CLIENT') {
          if (response === 'handshake-hold') received.resolve()
          else socket.write('+OK\r\n')
        } else if (args[0]?.toUpperCase() === 'GET') {
          received.resolve()
          if (response === 'miss') socket.write('$-1\r\n')
          if (response === 'write' || response === 'unreplicated' || response === 'delayed-replica') {
            const value = values.get(args[1] ?? '')
            socket.write(value === undefined ? '$-1\r\n' : `$${Buffer.byteLength(value)}\r\n${value}\r\n`)
          }
          if (response === 'error') socket.write('-WRONGTYPE fixture\r\n')
        } else if (args[0]?.toUpperCase() === 'SET') {
          writes++
          values.set(args[1] ?? '', args[2] ?? '')
          socket.write('+OK\r\n')
        } else if (args[0]?.toUpperCase() === 'DEL') {
          values.delete(args[1] ?? '')
          socket.write(':1\r\n')
        } else if (args[0]?.toUpperCase() === 'WAIT') {
          waits.push(args.slice(1))
          if (response !== 'replica-timeout' || waits.length === 1)
            socket.write(
              response === 'unreplicated' ||
                response === 'replica-timeout' ||
                (response === 'delayed-replica' && waits.length === 1)
                ? ':0\r\n'
                : ':1\r\n',
            )
        } else if (args[0]?.toUpperCase() === 'PING') {
          if (response !== 'hold' && response !== 'handshake-hold' && response !== 'replica-timeout')
            socket.write('+PONG\r\n')
        } else socket.write('-ERR unsupported fixture command\r\n')
      }
    })
    socket.on('close', () => {
      closes++
      connectionClosed.resolve()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP test listener')
  return {
    received: received.promise,
    closed: () => closed.promise,
    closes: () => closes,
    writes: () => writes,
    waits: () => waits,
    resumeReads: () => {
      response = 'miss'
    },
    stop: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
    layer: Layer.effect(ValkeyCache, makeValkeyCache).pipe(
      Layer.provide(
        NodeRedis.layer({
          RESP: 2,
          disableOfflineQueue: true,
          commandOptions: { timeout: mode === 'replica-timeout' ? 2000 : 100 },
          pingInterval: 100,
          socket: {
            host: '127.0.0.1',
            port: address.port,
            reconnectStrategy: false,
            connectTimeout: 100,
            socketTimeout: mode === 'replica-timeout' ? 3000 : 250,
          },
        }),
      ),
    ),
  }
}

const runTransport = async <A, E>(
  mode: 'miss' | 'hold' | 'error' | 'handshake-hold' | 'write' | 'unreplicated' | 'delayed-replica',
  effect: Effect.Effect<A, E, ValkeyCache>,
) => {
  const fixture = await transportFixture(mode)
  try {
    const result = await effect.pipe(Effect.provide(fixture.layer), Effect.result, Effect.runPromise)
    await fixture.closed()
    expect(fixture.closes()).toBe(1)
    return result
  } finally {
    await fixture.stop()
  }
}

const operation = <A, E>(f: (cache: ValkeyCache['Service']) => Effect.Effect<A, E>) => Effect.flatMap(ValkeyCache, f)

describe('required native Effect Valkey binding', () => {
  test('missing configuration fails startup without an operation', async () => {
    const result = await Effect.void.pipe(
      Effect.provide(ValkeyCacheLive),
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown({})),
      Effect.result,
      Effect.runPromise,
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ValkeyCacheError)
  })
  test('shares the native scoped connection across concurrent reads', async () => {
    const result = await runTransport(
      'miss',
      operation((cache) => Effect.all([cache.get('bayn:first'), cache.get('bayn:second')], { concurrency: 2 })),
    )
    expect(Result.isSuccess(result)).toBe(true)
    if (Result.isSuccess(result)) expect(result.success.every(Option.isNone)).toBe(true)
  })
  test('publishes and reads real broker-sized values after replica acknowledgement', async () => {
    const result = await runTransport(
      'write',
      operation((cache) =>
        Effect.gen(function* () {
          const value = 'x'.repeat(768_935)
          yield* cache.put({ key: 'bayn:large', value, ttlMs: 60_000 })
          expect(Option.getOrNull(yield* cache.get('bayn:large'))).toBe(value)
          yield* cache.remove('bayn:large')
          expect(Option.isNone(yield* cache.get('bayn:large'))).toBe(true)
        }),
      ),
    )
    expect(Result.isSuccess(result)).toBe(true)
  })
  test('a later replica acknowledgement completes the original write', async () => {
    const fixture = await transportFixture('delayed-replica')
    try {
      const result = await operation((cache) =>
        cache.put({ key: 'bayn:test', value: 'value', ttlMs: 1000 }).pipe(Effect.andThen(cache.get('bayn:test'))),
      ).pipe(Effect.provide(fixture.layer), Effect.result, Effect.runPromise)
      expect(Result.isSuccess(result)).toBe(true)
      if (Result.isSuccess(result)) expect(Option.getOrNull(result.success)).toBe('value')
      expect(fixture.writes()).toBe(1)
      expect(fixture.waits()).toEqual([
        ['1', '250'],
        ['1', '250'],
      ])
      await fixture.closed()
      expect(fixture.closes()).toBe(1)
    } finally {
      await fixture.stop()
    }
  })
  test('a missing replica acknowledgement fails after one bounded retry', async () => {
    const fixture = await transportFixture('unreplicated')
    try {
      const result = await operation((cache) => cache.put({ key: 'bayn:test', value: 'value', ttlMs: 1000 })).pipe(
        Effect.provide(fixture.layer),
        Effect.result,
        Effect.runPromise,
      )
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result) && result.failure instanceof ValkeyCacheError)
        expect(String(result.failure.cause)).toContain('replica')
      expect(fixture.writes()).toBe(1)
      expect(fixture.waits()).toEqual([
        ['1', '250'],
        ['1', '250'],
      ])
      await fixture.closed()
      expect(fixture.closes()).toBe(1)
    } finally {
      await fixture.stop()
    }
  })
  test('replica acknowledgement retry cannot outlive the command deadline', async () => {
    const fixture = await transportFixture('replica-timeout')
    try {
      const result = await operation((cache) => cache.put({ key: 'bayn:test', value: 'value', ttlMs: 1000 })).pipe(
        Effect.provide(fixture.layer),
        Effect.result,
        Effect.runPromise,
      )
      expect(Result.isFailure(result)).toBe(true)
      if (Result.isFailure(result) && result.failure instanceof ValkeyCacheError)
        expect(result.failure.message).toBe('Valkey command exceeded its deadline')
      expect(fixture.writes()).toBe(1)
      expect(fixture.waits()).toEqual([
        ['1', '250'],
        ['1', '250'],
      ])
      await fixture.closed()
      expect(fixture.closes()).toBe(1)
    } finally {
      await fixture.stop()
    }
  })
  test('the next operation reconnects after an aborted command without a legacy client', async () => {
    const fixture = await transportFixture('hold')
    try {
      const result = await operation((cache) =>
        Effect.gen(function* () {
          expect(Result.isFailure(yield* cache.get('bayn:first').pipe(Effect.result))).toBe(true)
          fixture.resumeReads()
          return yield* cache.get('bayn:second')
        }),
      ).pipe(Effect.provide(fixture.layer), Effect.runPromise)
      expect(Option.isNone(result)).toBe(true)
      await fixture.closed()
      expect(fixture.closes()).toBe(2)
    } finally {
      await fixture.stop()
    }
  })
  test('concurrent operations reconnect together after an aborted command', async () => {
    const fixture = await transportFixture('hold')
    try {
      const values = await operation((cache) =>
        Effect.gen(function* () {
          expect(Result.isFailure(yield* cache.get('bayn:first').pipe(Effect.result))).toBe(true)
          fixture.resumeReads()
          return yield* Effect.all([cache.get('bayn:second'), cache.get('bayn:third')], { concurrency: 2 })
        }),
      ).pipe(Effect.provide(fixture.layer), Effect.runPromise)
      expect(values.every(Option.isNone)).toBe(true)
      await fixture.closed()
      expect(fixture.closes()).toBe(2)
    } finally {
      await fixture.stop()
    }
  })
  test('interrupting a queued command leaves the active connection alone', async () => {
    const fixture = await transportFixture('hold')
    try {
      await operation((cache) =>
        Effect.gen(function* () {
          const active = yield* cache
            .get('bayn:active')
            .pipe(Effect.result, Effect.forkChild({ startImmediately: true }))
          yield* Effect.promise(() => fixture.received)
          const queued = yield* cache.get('bayn:queued').pipe(Effect.forkChild({ startImmediately: true }))
          yield* Fiber.interrupt(queued)
          yield* Effect.sleep('10 millis')
          expect(fixture.closes()).toBe(0)
          expect(Result.isFailure(yield* Fiber.join(active))).toBe(true)
        }),
      ).pipe(Effect.provide(fixture.layer), Effect.runPromise)
      await fixture.closed()
      expect(fixture.closes()).toBe(1)
    } finally {
      await fixture.stop()
    }
  })
  test('a transport error remains a failure and retains its cause', async () => {
    const result = await runTransport(
      'error',
      operation((cache) => cache.get('bayn:test')),
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result) && result.failure instanceof ValkeyCacheError) {
      expect(result.failure.operation).toBe('get')
      expect(String(result.failure.cause)).toContain('WRONGTYPE')
    }
  })
  test('a stalled command fails and native scope release closes the socket', async () => {
    const result = await runTransport(
      'hold',
      operation((cache) => cache.get('bayn:test')),
    )
    expect(Result.isFailure(result)).toBe(true)
  })
  test('a stalled startup handshake fails and closes the socket', async () => {
    const result = await runTransport(
      'handshake-hold',
      Effect.void.pipe(
        Effect.provideService(ValkeyCache, {
          get: () => Effect.die('startup must fail'),
          put: () => Effect.die('startup must fail'),
          remove: () => Effect.die('startup must fail'),
        }),
      ),
    )
    expect(Result.isFailure(result)).toBe(true)
  })
  test('interruption unwinds the native scope and cancels pending work', async () => {
    const fixture = await transportFixture('hold')
    try {
      await Effect.gen(function* () {
        const cache = yield* ValkeyCache
        const fiber = yield* Effect.forkScoped(cache.get('bayn:test'))
        yield* Effect.promise(() => fixture.received)
        yield* Fiber.interrupt(fiber)
      }).pipe(Effect.scoped, Effect.provide(fixture.layer), Effect.runPromise)
      await fixture.closed()
      expect(fixture.closes()).toBe(1)
    } finally {
      await fixture.stop()
    }
  })
})

describe('Valkey command boundary', () => {
  const rejected = async (
    f: (cache: ValkeyCache['Service']) => Effect.Effect<unknown, ValkeyCacheInputError | ValkeyCacheError>,
  ) => {
    const result = await runTransport('miss', operation(f))
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) expect(result.failure).toBeInstanceOf(ValkeyCacheInputError)
  }
  test('rejects foreign, empty and multiline keys', async () => {
    for (const key of ['other:private', 'bayn:', 'bayn:\n']) await rejected((cache) => cache.get(key))
    await rejected((cache) => cache.remove('other:private'))
  })
  test('requires finite positive bounded expiry', async () => {
    for (const ttlMs of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 300_001])
      await rejected((cache) => cache.put({ key: 'bayn:test', value: 'private-value', ttlMs }))
  })
  test('bounds actual broker-sized payloads without raising memory without limit', async () => {
    await rejected((cache) => cache.put({ key: 'bayn:test', value: 'x'.repeat(4_194_305), ttlMs: 1000 }))
  })
})

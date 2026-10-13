import { readFile } from 'node:fs/promises'

import { NodeRedis } from '@effect/platform-node'
import { Config, Context, Data, Effect, Layer, Option, Redacted, Schema } from 'effect'

export class ValkeyCacheError extends Data.TaggedError('ValkeyCacheError')<{
  readonly operation: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class ValkeyCacheInputError extends Data.TaggedError('ValkeyCacheInputError')<{
  readonly operation: string
  readonly message: string
}> {}

export const ValkeyKey = Schema.String.check(Schema.isPattern(/^bayn:.{1,250}$/))
export const ValkeyWrite = Schema.Struct({
  key: ValkeyKey,
  value: Schema.String.check(Schema.isMaxLength(262_144)),
  ttlMs: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(300_000)),
})

export class ValkeyCache extends Context.Service<
  ValkeyCache,
  {
    readonly get: (key: string) => Effect.Effect<Option.Option<string>, ValkeyCacheError | ValkeyCacheInputError>
    readonly put: (input: typeof ValkeyWrite.Type) => Effect.Effect<void, ValkeyCacheError | ValkeyCacheInputError>
    readonly remove: (key: string) => Effect.Effect<void, ValkeyCacheError | ValkeyCacheInputError>
  }
>()('bayn/ValkeyCache') {}

export const valkeyConfig = Config.all({
  host: Config.NonEmptyString('VALKEY_HOST'),
  port: Config.Port('VALKEY_PORT').pipe(Config.withDefault(6379)),
  username: Config.NonEmptyString('VALKEY_USERNAME').pipe(Config.withDefault('default')),
  password: Config.Redacted('VALKEY_PASSWORD'),
  serverName: Config.NonEmptyString('VALKEY_TLS_SERVER_NAME'),
  tlsDirectory: Config.NonEmptyString('BAYN_VALKEY_TLS_DIRECTORY').pipe(
    Config.withDefault('/var/run/secrets/bayn/valkey'),
  ),
})

export const makeValkeyCache = Effect.gen(function* () {
  const { client } = yield* NodeRedis.NodeRedis
  const destroy = Effect.sync(() => {
    if (client.isOpen) client.destroy()
  })
  yield* Effect.addFinalizer(() => destroy)

  const command = <A>(operation: string, run: (signal: AbortSignal) => Promise<A>) =>
    Effect.tryPromise({
      try: async (signal) => {
        if (!client.isOpen) await client.connect()
        return run(signal)
      },
      catch: (cause) => new ValkeyCacheError({ operation, message: 'Valkey command failed', cause }),
    }).pipe(
      Effect.onInterrupt(() => destroy),
      Effect.timeoutOrElse({
        duration: '1 second',
        orElse: () => Effect.fail(new ValkeyCacheError({ operation, message: 'Valkey command exceeded its deadline' })),
      }),
      Effect.withSpan(`bayn.valkey.${operation}`),
    )

  const key = (operation: string, input: string) =>
    Schema.decodeUnknownEffect(ValkeyKey)(input).pipe(
      Effect.mapError(() => new ValkeyCacheInputError({ operation, message: 'Cache keys must use the bayn: prefix' })),
    )

  return ValkeyCache.of({
    get: (input) =>
      key('get', input).pipe(
        Effect.flatMap((key) => command('get', (signal) => client.withAbortSignal(signal).get(key))),
        Effect.map(Option.fromNullishOr),
      ),
    put: (input) =>
      Schema.decodeUnknownEffect(ValkeyWrite)(input).pipe(
        Effect.mapError(
          () =>
            new ValkeyCacheInputError({
              operation: 'put',
              message: 'Cache writes require a bayn: key, bounded value and TTL of 1–300000 ms',
            }),
        ),
        Effect.flatMap(({ key, value, ttlMs }) =>
          command('put', (signal) => client.withAbortSignal(signal).set(key, value, { PX: ttlMs })),
        ),
        Effect.asVoid,
      ),
    remove: (input) =>
      key('remove', input).pipe(
        Effect.flatMap((key) => command('remove', (signal) => client.withAbortSignal(signal).del(key))),
        Effect.asVoid,
      ),
  })
})

export const ValkeyCacheLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* valkeyConfig.pipe(
      Effect.mapError(
        (cause) =>
          new ValkeyCacheError({ operation: 'configure', message: 'Valkey configuration is unavailable', cause }),
      ),
    )
    const readTls = (name: string) =>
      Effect.tryPromise({
        try: (signal) => readFile(`${config.tlsDirectory}/${name}`, { encoding: 'utf8', signal }),
        catch: (cause) =>
          new ValkeyCacheError({ operation: 'configure', message: 'Cannot read Valkey TLS material', cause }),
      })
    const { ca, cert, key } = yield* Effect.all({
      ca: readTls('ca.crt'),
      cert: readTls('tls.crt'),
      key: readTls('tls.key'),
    })
    return Layer.effect(ValkeyCache, makeValkeyCache).pipe(
      Layer.provide(
        NodeRedis.layer({
          username: config.username,
          password: Redacted.value(config.password),
          disableOfflineQueue: true,
          commandOptions: { timeout: 250 },
          socket: {
            host: config.host,
            port: config.port,
            tls: true,
            servername: config.serverName,
            ca,
            cert,
            key,
            connectTimeout: 1000,
            reconnectStrategy: false,
          },
        }).pipe(
          Layer.catch((cause) =>
            Layer.effectContext(
              Effect.fail(new ValkeyCacheError({ operation: 'connect', message: 'Cannot connect to Valkey', cause })),
            ),
          ),
        ),
      ),
    )
  }),
)

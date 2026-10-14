import { Data, Result, Schema } from 'effect'

import { sha256 } from '../hash'

class NativeNumber {
  constructor(readonly token: string) {}
}

export class NativeJsonError extends Data.TaggedError('NativeJsonError')<{
  readonly message: string
  readonly cause?: unknown
}> {}

const canonical = (value: unknown): Result.Result<string, NativeJsonError> =>
  Result.gen(function* () {
    if (value instanceof NativeNumber) return value.token
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${(yield* Result.all(value.map(canonical))).join(',')}]`
    if (typeof value !== 'object')
      return yield* Result.fail(new NativeJsonError({ message: 'invalid native JSON value' }))
    const entries = Object.entries(value).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    return `{${(yield* Result.all(
      entries.map(([key, child]) =>
        canonical(child).pipe(Result.map((encoded) => `${JSON.stringify(key)}:${encoded}`)),
      ),
    )).join(',')}}`
  })

export const nativePayloadCanonicalJson = (record: string): Result.Result<string, NativeJsonError> =>
  Result.gen(function* () {
    const parsed: unknown = yield* Result.try({
      try: () =>
        JSON.parse(record, (_key: string, value: unknown, context?: { readonly source?: string }) => {
          if (typeof value !== 'number') return value
          if (context?.source === undefined) throw new Error('runtime lacks native JSON number source support')
          return new NativeNumber(context.source)
        }),
      catch: (cause) => new NativeJsonError({ message: 'native market envelope is not lossless JSON', cause }),
    })
    const envelope = yield* Schema.decodeUnknownResult(Schema.Struct({ payload: Schema.Unknown }))(parsed).pipe(
      Result.mapError((cause) => new NativeJsonError({ message: 'native market envelope has no payload', cause })),
    )
    return yield* canonical(envelope.payload)
  })

export const nativeSourceContentHash = (identity: readonly string[], canonicalPayload: string): string =>
  sha256(`[${identity.map((value) => JSON.stringify(value)).join(',')},${canonicalPayload}]`)

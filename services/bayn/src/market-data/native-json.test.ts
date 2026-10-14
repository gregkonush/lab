import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { nativePayloadCanonicalJson, nativeSourceContentHash } from './native-json'
import { sha256 } from '../hash'

test('native source hashing preserves decimal and exponent tokens while ordering object keys', () => {
  const payload = Result.getOrThrow(
    nativePayloadCanonicalJson('{"payload":{"v":1.000000000,"c":82000.123456789,"x":[1e-9,-0.0]}}'),
  )
  expect(payload).toBe('{"c":82000.123456789,"v":1.000000000,"x":[1e-9,-0.0]}')
  expect(nativeSourceContentHash(['alpaca', 'us', 'BTC/USD'], payload)).toBe(
    sha256(`["alpaca","us","BTC/USD",${payload}]`),
  )
  expect(payload).not.toBe(JSON.stringify(JSON.parse(payload)))
})

test('malformed native envelopes fail without manufacturing a payload', () => {
  for (const record of ['{', '{}', 'null', '{"payload":NaN}'])
    expect(Result.isFailure(nativePayloadCanonicalJson(record))).toBe(true)
})

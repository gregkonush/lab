import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { sha256 } from '../hash'
import { decodeEquityEdgeInput, decodeEquityEdgeSource } from './equity-edge-source'

const fixture = () => {
  const calendar = Array.from({ length: 17 }, (_, i) => ({
    date: `2026-08-${String(i + 3).padStart(2, '0')}`,
    open: '09:30',
    close: '16:00',
    session_open: '0400',
    session_close: '2000',
  }))
  const at = '2026-10-17T06:24:39.700Z'
  const material = [
    { kind: 'calendar', observedAt: at, data: calendar },
    {
      kind: 'bars',
      page: 0,
      observedAt: at,
      data: {
        bars: { SPY: [{ t: '2026-08-03T13:30:00Z', o: 100, h: 101, l: 99, c: 100, v: 10, vw: 100 }] },
        next_page_token: null,
      },
    },
    { kind: 'complete', pages: 1, bars: 1, feed: 'iex', adjustment: 'raw', observedAt: at },
  ]
  const text = material.map((row) => JSON.stringify(row)).join('\n') + '\n'
  const input = {
    schemaVersion: 'bayn.equity-edge-screen-input.v1',
    sourceSha256: sha256(text),
    symbols: ['SPY', 'AAPL'],
    development: { start: '2026-08-17', end: '2026-08-17' },
    validation: { start: '2026-08-18', end: '2026-08-18' },
    holdout: { start: '2026-08-19', end: '2026-08-19' },
  }
  return { text, input }
}

const decode = (text: string, input: unknown) =>
  decodeEquityEdgeInput(input).pipe(Result.flatMap((value) => decodeEquityEdgeSource(text, value)))

test('source preserves regular exchange hours, byte identity, explicit holes and separate partitions', () => {
  const { text, input } = fixture()
  const result = decode(text, input)
  if (Result.isFailure(result)) throw result.failure
  expect(result.success.days[0]?.openAt).toBe(Date.parse('2026-08-03T13:30:00Z'))
  expect(result.success.days[0]?.closeAt).toBe(Date.parse('2026-08-03T20:00:00Z'))
  expect(result.success.source.bars).toBe(1)
  expect(result.success.coverage[0]?.symbols).toEqual([
    { symbol: 'SPY', expected: 390, observed: 1, missing: 389 },
    { symbol: 'AAPL', expected: 390, observed: 0, missing: 390 },
  ])
  expect(result.success.source.originalArrivalTiming).toBe('UNKNOWN')
})

test('changed source bytes fail even when JSON meaning is unchanged', () => {
  const { text, input } = fixture()
  expect(Result.isFailure(decode(text + '\n', input))).toBe(true)
})

test.each(['missing terminator', 'wrong page count', 'foreign feed', 'repeated cursor', 'duplicate bar'] as const)(
  'rejects %s after rehashing',
  (failure) => {
    const { text, input } = fixture()
    let changed = text
    if (failure === 'missing terminator') changed = text.trimEnd().split('\n').slice(0, -1).join('\n')
    if (failure === 'wrong page count') changed = text.replace('"pages":1', '"pages":2')
    if (failure === 'foreign feed') changed = text.replace('"feed":"iex"', '"feed":"sip"')
    if (failure === 'repeated cursor')
      changed = text.replace('"next_page_token":null', '"next_page_token":"nonterminal"')
    if (failure === 'duplicate bar') {
      const row = '{"t":"2026-08-03T13:30:00Z","o":100,"h":101,"l":99,"c":100,"v":10,"vw":100}'
      changed = text.replace(row, `${row},${row}`).replace('"bars":1', '"bars":2')
    }
    expect(Result.isFailure(decode(changed, { ...input, sourceSha256: sha256(changed) }))).toBe(true)
  },
)

test('forbids temporal overlap, unknown request fields, missing warmup and a missing benchmark', () => {
  const { text, input } = fixture()
  expect(Result.isFailure(decode(text, { ...input, validation: input.development }))).toBe(true)
  expect(Result.isFailure(decode(text, { ...input, allowTrading: true }))).toBe(true)
  expect(Result.isFailure(decode(text, { ...input, development: { start: '2026-08-16', end: '2026-08-17' } }))).toBe(
    true,
  )
  expect(Result.isFailure(decode(text, { ...input, symbols: ['AAPL'] }))).toBe(true)
})

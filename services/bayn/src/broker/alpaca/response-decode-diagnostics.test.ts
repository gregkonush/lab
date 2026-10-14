import { expect, test } from 'bun:test'
import { Result, Schema, SchemaIssue } from 'effect'

import { decodePositions } from './model'
import { positionDecodeDiagnostic } from './response-decode-diagnostics'

const position = {
  asset_id: 'b0b6dd9d-8b9b-48a9-ba46-b9d54906e415',
  symbol: 'AAPL',
  exchange: 'NASDAQ',
  asset_class: 'us_equity',
  avg_entry_price: '100',
  cost_basis: '500',
  qty: '5',
  side: 'long',
  market_value: '600',
  unrealized_pl: '100',
  current_price: '120',
}
const diagnostic = (input: unknown) => {
  const decoded = decodePositions(input)
  if (Result.isSuccess(decoded)) throw new Error('Expected synthetic rejection')
  return positionDecodeDiagnostic(decoded.failure, input)
}

test.each([
  ['null', null],
  ['number', 12345],
  ['boolean', true],
  ['object', { private: 'never report this value' }],
  ['array', ['private']],
] as const)('positions diagnostics report only the rejected %s type', (actualType, qty) => {
  expect(diagnostic([{ ...position, qty }])).toEqual({
    field: '[].qty',
    issue: 'type',
    expectedType: 'string',
    actualType,
  })
})

test('missing, enum, refinement and envelope failures have fixed categories', () => {
  const { qty: _, ...missing } = position
  expect(diagnostic([missing])).toEqual({
    field: '[].qty',
    issue: 'missing',
    expectedType: 'string',
    actualType: 'missing',
  })
  expect(diagnostic([{ ...position, exchange: 'private-exchange' }])).toEqual({
    field: '[].exchange',
    issue: 'enum',
    expectedType: 'string',
    actualType: 'string',
  })
  expect(diagnostic([{ ...position, qty: 'private-secret-value' }])).toEqual({
    field: '[].qty',
    issue: 'constraint',
    expectedType: 'string',
    actualType: 'string',
  })
  expect(diagnostic({ private: 'not an array' })).toEqual({
    field: '$',
    issue: 'type',
    expectedType: 'array',
    actualType: 'object',
  })
  expect(diagnostic([null])).toEqual({ field: '[]', issue: 'type', expectedType: 'object', actualType: 'null' })
})

test('indices, hostile values, arbitrary keys and formatted issue messages never escape', () => {
  const secret = 'sensitive-token-account-symbol-938475'
  const input = [...Array.from({ length: 17 }, () => position), { ...position, qty: secret }]
  expect(diagnostic(input)).toEqual(diagnostic([{ ...position, qty: secret }]))
  const issue = new SchemaIssue.Pointer([17, secret], new SchemaIssue.InvalidValue({ message: secret }))
  const error = new Schema.SchemaError(issue)
  Object.defineProperty(error, 'message', {
    get: () => {
      throw new Error('must not format errors')
    },
  })
  const result = positionDecodeDiagnostic(error, input)
  expect(result).toEqual({ field: 'unknown', issue: 'unknown', expectedType: 'unknown', actualType: 'unknown' })
  expect(JSON.stringify([result, diagnostic(input)])).not.toContain(secret)
  expect(JSON.stringify(diagnostic(input))).not.toContain('17')
})

test('diagnostics do not invoke input accessors or issue formatters', () => {
  const input = [{ ...position }]
  Object.defineProperty(input[0], 'qty', {
    get: () => {
      throw new Error('private getter')
    },
  })
  const error = new Schema.SchemaError(
    new SchemaIssue.Pointer([0, 'qty'], new SchemaIssue.InvalidType(Schema.String.ast)),
  )
  expect(positionDecodeDiagnostic(error, input)).toEqual({
    field: '[].qty',
    issue: 'type',
    expectedType: 'string',
    actualType: 'unknown',
  })
})

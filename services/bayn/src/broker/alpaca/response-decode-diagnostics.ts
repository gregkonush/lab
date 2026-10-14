import type { Schema, SchemaIssue } from 'effect'

import { PositionResponseSchema } from './model'

type DiagnosticType =
  | 'missing'
  | 'undefined'
  | 'null'
  | 'string'
  | 'number'
  | 'boolean'
  | 'array'
  | 'object'
  | 'other'
  | 'unknown'
type DiagnosticIssue = 'missing' | 'type' | 'enum' | 'constraint' | 'union' | 'unknown'
export interface PositionDecodeDiagnostic {
  readonly field: string
  readonly issue: DiagnosticIssue
  readonly expectedType: DiagnosticType
  readonly actualType: DiagnosticType
}

// This allowlist comes from the authored response contract, never from payload keys or issue messages.
const fields = new Set(Object.keys(PositionResponseSchema.fields))
const unknown: PositionDecodeDiagnostic = {
  field: 'unknown',
  issue: 'unknown',
  expectedType: 'unknown',
  actualType: 'unknown',
}

const typeOf = (value: unknown): DiagnosticType => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  switch (typeof value) {
    case 'undefined':
      return 'undefined'
    case 'string':
      return 'string'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'object':
      return 'object'
    default:
      return 'other'
  }
}

const actualTypeAt = (input: unknown, path: readonly PropertyKey[]): DiagnosticType => {
  let value = input
  for (const key of path) {
    if (value === null || typeof value !== 'object') return 'unknown'
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined) return 'missing'
    if (!('value' in descriptor)) return 'unknown'
    value = descriptor.value
  }
  return typeOf(value)
}

/** One bounded, value-free issue. Never format a SchemaError, AST, annotation or rejected input. */
export const positionDecodeDiagnostic = (error: Schema.SchemaError, input: unknown): PositionDecodeDiagnostic => {
  let issue: SchemaIssue.Issue = error.issue
  const path: PropertyKey[] = []
  let category: DiagnosticIssue = 'unknown'
  for (let depth = 0; depth < 16; depth++) {
    switch (issue._tag) {
      case 'Pointer':
        if (path.length + issue.path.length > 2) return unknown
        path.push(...issue.path)
        issue = issue.issue
        continue
      case 'Composite': {
        const first = issue.issues[0]
        if (first === undefined) return unknown
        issue = first
        continue
      }
      case 'Encoding':
        issue = issue.issue
        continue
      case 'Filter':
        category = 'constraint'
        break
      case 'MissingKey':
        category = 'missing'
        break
      case 'InvalidType':
        category = issue.ast._tag === 'Enum' ? 'enum' : 'type'
        break
      case 'AnyOf':
        category = 'union'
        break
      default:
        category = 'unknown'
    }
    const index = path[0]
    if (path.length === 0) return { field: '$', issue: category, expectedType: 'array', actualType: typeOf(input) }
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) return unknown
    if (path.length === 1)
      return { field: '[]', issue: category, expectedType: 'object', actualType: actualTypeAt(input, path) }
    const field = path[1]
    if (typeof field !== 'string' || !fields.has(field)) return unknown
    return { field: `[].${field}`, issue: category, expectedType: 'string', actualType: actualTypeAt(input, path) }
  }
  return unknown
}

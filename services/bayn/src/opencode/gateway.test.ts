import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { admitOpenCodeCall, type OpenCodeAttempt } from './gateway'
import { openCodeConfiguration, openCodeModel } from './configuration'

const request = (change: object = {}) => ({
  sessionId: 'ses_study',
  body: JSON.stringify({
    model: openCodeModel,
    stream: true,
    stream_options: { include_usage: true },
    max_completion_tokens: 4096,
    temperature: 0.6,
    response_format: openCodeConfiguration.providers.opencode.body.response_format,
    messages: [{ role: 'user', content: 'Native Jev feedback' }],
    tools: [],
    ...change,
  }),
})
const attempt = (): OpenCodeAttempt => ({ sessionId: 'ses_study', deadlineAtMs: 1000, calls: 0 })

test('only one native request can consume a registered attempt', () => {
  const state = attempt()
  expect(Result.isSuccess(admitOpenCodeCall(state, request(), 1))).toBe(true)
  expect(Result.isFailure(admitOpenCodeCall(state, request(), 2))).toBe(true)
  expect(state.calls).toBe(1)
})

test('inactive, expired and other-study calls cannot reach the hosted provider', () => {
  expect(Result.isFailure(admitOpenCodeCall(undefined, request(), 1))).toBe(true)
  expect(Result.isFailure(admitOpenCodeCall(attempt(), request(), 1000))).toBe(true)
  expect(Result.isFailure(admitOpenCodeCall(attempt(), { ...request(), sessionId: 'ses_other' }, 1))).toBe(true)
})

test('paid models, extra output, altered schema and oversized input are denied before consuming budget', () => {
  for (const changed of [
    { model: 'gpt-5' },
    { max_completion_tokens: 8192 },
    { max_tokens: 100000 },
    { response_format: { type: 'text' } },
    { messages: [{ role: 'user', content: 'x'.repeat(32768) }] },
  ]) {
    const state = attempt()
    expect(Result.isFailure(admitOpenCodeCall(state, request(changed), 1))).toBe(true)
    expect(state.calls).toBe(0)
  }
})

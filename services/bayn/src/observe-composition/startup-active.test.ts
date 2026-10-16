import { expect, test } from 'bun:test'
import { Result } from 'effect'

import { makeRuntimeProvenance, makeStrategyProtocolHashResult } from '../contracts'
import { canonicalHashV1 } from '../hash'
import { makeJevDefinition } from '../jev/decision'
import { decodeJevProtocol, defaultJevProtocolDocument } from '../jev/protocol'
import type { StrategyRuntime } from '../strategy'
import { fixtureRuntime } from '../testing/runtime-fixtures'
import { prepareObserveStartup } from './startup'

const prepare = (strategy: StrategyRuntime) =>
  prepareObserveStartup({
    accountId: 'test-account',
    authorityGenerationHash: 'b'.repeat(64),
    pollIntervalMs: 30_000,
    reconciliationIntervalMs: 30_000,
    reconciliationPassTimeoutMs: 30_000,
    strategy,
  })

test('autonomous startup admits the exact source-selected momentum-first identity', () => {
  expect(fixtureRuntime.definition.parameters.schemaVersion).toBe('bayn.jev.protocol.v8')
  const result = Result.getOrThrow(prepare(fixtureRuntime))
  expect(result.strategyProtocolHash).toBe(
    Result.getOrThrow(makeStrategyProtocolHashResult(fixtureRuntime.provenance.strategy)),
  )
  expect(result.strategyProtocolHash).toBe('04bf5314a5ab7886f1802f6aa5da64f4a080cb695b37c9adf042dbedf5fb3fba')
})

test('rejects retired Jev protocols at the only active protocol boundary', () => {
  for (const schemaVersion of ['bayn.jev.protocol.v1', 'bayn.jev.protocol.v2']) {
    expect(Result.isFailure(decodeJevProtocol({ ...defaultJevProtocolDocument, schemaVersion }))).toBe(true)
  }
})

test('a rehashed custom momentum protocol cannot substitute for the approved active document', () => {
  const protocol = Result.getOrThrow(
    decodeJevProtocol({ ...fixtureRuntime.definition.parameters, minimumExitProbability: 0.66 }),
  )
  const changed: StrategyRuntime = {
    definition: makeJevDefinition(protocol),
    provenance: makeRuntimeProvenance({
      ...fixtureRuntime.provenance,
      strategy: { ...fixtureRuntime.provenance.strategy, parameterHash: canonicalHashV1(protocol) },
    }),
  }
  expect(Result.isFailure(prepare(changed))).toBe(true)
})

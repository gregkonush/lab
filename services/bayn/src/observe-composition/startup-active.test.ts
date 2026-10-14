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
  expect(fixtureRuntime.definition.parameters.schemaVersion).toBe('bayn.jev.protocol.v3')
  const result = Result.getOrThrow(prepare(fixtureRuntime))
  expect(result.strategyProtocolHash).toBe(
    Result.getOrThrow(makeStrategyProtocolHashResult(fixtureRuntime.provenance.strategy)),
  )
  expect(result.strategyProtocolHash).toBe('1d91d5148c8bedc5631c21881975af5be8db334826eb143335d4c7a663e0d394')
})

test('rejects retired Jev protocols at the only active protocol boundary', () => {
  for (const schemaVersion of ['bayn.jev.protocol.v1', 'bayn.jev.protocol.v2']) {
    expect(Result.isFailure(decodeJevProtocol({ ...defaultJevProtocolDocument, schemaVersion }))).toBe(true)
  }
})

test('a rehashed custom momentum protocol cannot substitute for the approved active document', () => {
  const protocol = Result.getOrThrow(
    decodeJevProtocol({ ...fixtureRuntime.definition.parameters, minimumEntryProbability: 0.66 }),
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

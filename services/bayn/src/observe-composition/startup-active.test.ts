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

test('autonomous startup admits the exact source-selected model trade-plan identity', () => {
  expect(fixtureRuntime.definition.parameters.schemaVersion).toBe('bayn.jev.protocol.v15')
  const result = Result.getOrThrow(prepare(fixtureRuntime))
  expect(result.strategyProtocolHash).toBe(
    Result.getOrThrow(makeStrategyProtocolHashResult(fixtureRuntime.provenance.strategy)),
  )
  expect(result.strategyProtocolHash).toBe('358241b51b40e89e43d2a0ccee695ff673ffd2ad02dd4f1c7652c8b0cbda8c59')
})

test('rejects retired Jev protocols at the only active protocol boundary', () => {
  for (const schemaVersion of ['bayn.jev.protocol.v1', 'bayn.jev.protocol.v2', 'bayn.jev.protocol.v13']) {
    expect(Result.isFailure(decodeJevProtocol({ ...defaultJevProtocolDocument, schemaVersion }))).toBe(true)
  }
})

test('a rehashed custom trade-plan protocol cannot substitute for the approved active document', () => {
  const protocol = Result.getOrThrow(
    decodeJevProtocol({ ...fixtureRuntime.definition.parameters, maximumSymbolWeight: 0.19 }),
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

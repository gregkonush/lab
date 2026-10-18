import { describe, expect, test } from 'bun:test'
import { Result } from 'effect'

import { canonicalHashV1OrThrow } from '../hash'
import { decodeJevProtocol, defaultJevProtocolDocument } from '../jev/protocol'
import { decodeDefaultIntradayMomentumProtocol } from './intraday-momentum/protocol'

describe('shared intraday market contract', () => {
  test('binds active and research protocols to observed-history features', () => {
    const jev = Result.getOrThrow(decodeJevProtocol(defaultJevProtocolDocument))
    const momentum = Result.getOrThrow(decodeDefaultIntradayMomentumProtocol())

    expect(canonicalHashV1OrThrow(jev)).toBe('ca77ee9e9a5bbab64e74164a3547f5e70be699b10f49f6880e4f4e144e4a379d')
    expect(canonicalHashV1OrThrow(momentum)).toBe('0dccbe2abe3a380a987bcb2bbf6af299ff317d94df0198a35de3f89cbd28a775')
    expect(jev.lookbackMinutes).toBe(30)
    expect(jev.decisionDelaySeconds).toBe(2)
    expect(momentum.lookbackMinutes).toBe(jev.lookbackMinutes)
    expect(momentum.decisionDelaySeconds).toBe(jev.decisionDelaySeconds)
  })

  test.each([
    { lookbackMinutes: 29 },
    { lookbackMinutes: 31 },
    { decisionDelaySeconds: 1 },
    { decisionDelaySeconds: 3 },
  ])('rejects a Jev window that differs from its pinned contract: %j', (window) => {
    expect(Result.isFailure(decodeJevProtocol({ ...defaultJevProtocolDocument, ...window }))).toBe(true)
  })
})

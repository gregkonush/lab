import { describe, expect, test } from 'bun:test'
import { Result } from 'effect'

import { canonicalHashV1OrThrow } from '../hash'
import { decodeJevProtocol, defaultJevProtocolDocument } from '../jev/protocol'
import { decodeDefaultIntradayMomentumProtocol } from './intraday-momentum/protocol'

describe('shared intraday market contract', () => {
  test('preserves the active and retained protocol identities', () => {
    const jev = Result.getOrThrow(decodeJevProtocol(defaultJevProtocolDocument))
    const momentum = Result.getOrThrow(decodeDefaultIntradayMomentumProtocol())

    expect(canonicalHashV1OrThrow(jev)).toBe('d97d393a316dd769857752321bd6951d3e7e7efad2df97523e585efe07625ca3')
    expect(canonicalHashV1OrThrow(momentum)).toBe('558b80751a44bea69bef1d1dd810a16ddfee614c23bbb89652e6ea0e7e148669')
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

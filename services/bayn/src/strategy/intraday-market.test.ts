import { describe, expect, test } from 'bun:test'
import { Result } from 'effect'

import { canonicalHashV1OrThrow } from '../hash'
import { decodeJevProtocol, defaultJevProtocolDocument } from '../jev/protocol'
import { decodeDefaultIntradayMomentumProtocol } from './intraday-momentum/protocol'

describe('shared intraday market contract', () => {
  test('binds active and research protocols to observed-history features', () => {
    const jev = Result.getOrThrow(decodeJevProtocol(defaultJevProtocolDocument))
    const momentum = Result.getOrThrow(decodeDefaultIntradayMomentumProtocol())

    expect(canonicalHashV1OrThrow(jev)).toBe('0121b343836d2b1376c4f4ef2d4d499061d09d37f6b509c365c5d6eb44ac0d00')
    expect(canonicalHashV1OrThrow(momentum)).toBe('425f0e735349cae83a89c1903e6b8b578775087cc81b3bfc1705bb8f5d2330d5')
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

import { Schema } from 'effect'

import { PositiveIntegerSchema } from '../schemas'
import type { JevProtocol } from './protocol'

export const positionProtectionIntervalMs = 5_000 as const

export const jevProfitTargetProceeds = (acquisitionCostMicros: bigint, profitTargetNetBps: number): bigint =>
  acquisitionCostMicros + (acquisitionCostMicros * BigInt(profitTargetNetBps) + 9_999n) / 10_000n

export const JevPositionExitPolicySchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.position-exit-policy.v1'),
  maximumPriceCheckIntervalMs: Schema.Literal(positionProtectionIntervalMs),
  protectiveStopBps: PositiveIntegerSchema.check(Schema.isLessThanOrEqualTo(500)),
  profitTargetNetBps: PositiveIntegerSchema.check(Schema.isLessThanOrEqualTo(1_000)),
  maximumHoldingMinutes: PositiveIntegerSchema.check(Schema.isLessThanOrEqualTo(60)),
})

export const jevPositionExitPolicy = (protocol: JevProtocol): typeof JevPositionExitPolicySchema.Type => ({
  schemaVersion: 'bayn.position-exit-policy.v1',
  maximumPriceCheckIntervalMs: positionProtectionIntervalMs,
  protectiveStopBps: protocol.protectiveStopBps,
  profitTargetNetBps: protocol.profitTargetNetBps,
  maximumHoldingMinutes: protocol.maximumHoldingMinutes,
})

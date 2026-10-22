import { Schema } from 'effect'

import { StrictNonEmptyStringSchema } from '../schemas'

export const JevInstructionsSchema = Schema.Struct({
  entry: StrictNonEmptyStringSchema.check(Schema.isMaxLength(2000)),
})
export type JevInstructions = typeof JevInstructionsSchema.Type

export const jevInstructions: JevInstructions = {
  entry:
    'Using `candidate`, `benchmark`, `relativeSignals`, `entryEconomics` and `session`, select one supplied complete long entry plan only when the evidence supports both its thesis-invalidation stop and reaching its target within `task.horizonMinutes` after estimated execution costs. The options are hypothetical order terms, not forecasts or additional observed data. A plan being funded does not make it likely or profitable. Choose wait or avoid when no complete plan is supported. No positive historical return or benchmark outperformance is required. Code owns permission, quantity, freshness, broker protection and account risk.',
}

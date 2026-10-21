import { Schema } from 'effect'

import { StrictNonEmptyStringSchema } from '../schemas'

const Instruction = StrictNonEmptyStringSchema.check(Schema.isMaxLength(2000))
export const JevInstructionsSchema = Schema.Struct({
  entry: Instruction,
  stopLoss: Instruction,
  takeProfit: Instruction,
})
export type JevInstructions = typeof JevInstructionsSchema.Type

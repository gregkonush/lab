import { Schema } from 'effect'

import { GitSourceRevisionSchema, ImageDigestSchema, ImageRepositorySchema, Sha256Schema } from '../schemas'
import { JevInstructionsSchema } from './instructions-contract'

export const JevHarnessVariantSpecSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-harness2-variant.v1'),
  sourceRevision: GitSourceRevisionSchema,
  imageRepository: ImageRepositorySchema,
  baseImageDigest: ImageDigestSchema,
  instructions: JevInstructionsSchema,
})

export const JevHarnessVariantBuildSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-harness2-variant-build.v1'),
  spec: JevHarnessVariantSpecSchema,
  baselineInstructionsHash: Sha256Schema,
  instructionsHash: Sha256Schema,
  strategyBehaviorHash: Sha256Schema,
  strategyParameterHash: Sha256Schema,
  executableSha256: Sha256Schema,
  bunVersion: Schema.Literal('1.4.2'),
  replacedSourceModule: Schema.Literal('services/bayn/src/jev/instructions.ts'),
  sourceVerification: Schema.Literal('CLEAN_COMMITTED_BUILD_INPUTS'),
  baseImageVerification: Schema.Literal('REQUIRES_RUNTIME_READBACK'),
  qualification: Schema.Literal('UNQUALIFIED'),
  receiptHash: Sha256Schema,
})

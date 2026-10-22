import { Data, Result, Schema } from 'effect'

import { canonicalHashV1Result, sha256 } from '../hash'
import { JevInstructionsSchema } from '../jev/instructions-contract'
import {
  GitSourceRevisionSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  Sha256Schema,
  StrictNonEmptyStringSchema,
  UnsignedMicrosSchema,
  UtcInstantSchema,
  strictParseOptions,
} from '../schemas'

export class ResearchError extends Data.TaggedError('ResearchError')<{
  readonly message: string
  readonly cause?: unknown
}> {}
export const editorModel = 'qwen3-jev-editor-b968826d9c46'
export const editorCheckpoint = 'b968826d9c46dd6066d109eabc6255188de91218'
export const maximumResearchStreamBytes = 2 * 1024 * 1024
export const maximumResearchReceiptBytes = 5 * 1024 * 1024
const Text = StrictNonEmptyStringSchema.check(Schema.isMaxLength(100_000))
const Unit = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
export const ResearchPolicySchema = Schema.Struct({
  model: Schema.Literal(editorModel),
  checkpoint: Schema.Literal(editorCheckpoint),
  servingImage: Schema.Literal('sha256:7ef5a35d1ef8ce2cf9d671dd91eec6e367c5849262e0362b4d3d4a26be0d87d2'),
  tokenizerRevision: Schema.Literal(editorCheckpoint),
  chatTemplateRevision: Schema.Literal(editorCheckpoint),
  temperature: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 2 })),
  top_p: Unit,
  top_k: Schema.Int.check(Schema.isGreaterThanOrEqualTo(-1)),
  min_p: Unit,
  seed: NonNegativeIntegerSchema,
  presence_penalty: Schema.Finite.check(Schema.isBetween({ minimum: -2, maximum: 2 })),
  frequency_penalty: Schema.Finite.check(Schema.isBetween({ minimum: -2, maximum: 2 })),
  repetition_penalty: Schema.Finite.check(Schema.isGreaterThan(0)),
  enable_thinking: Schema.Boolean,
  max_tokens: PositiveIntegerSchema.check(Schema.isLessThanOrEqualTo(4096)),
  stop: Schema.Array(Text).check(Schema.isMaxLength(8)),
})
export const ResearchRunSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-editor.v1'),
  purpose: Schema.Literal('prompt-edit'),
  sourceRevision: GitSourceRevisionSchema,
  studyHash: Sha256Schema,
  armManifestHashes: Schema.Array(Sha256Schema).check(Schema.isMinLength(1), Schema.isMaxLength(16), Schema.isUnique()),
  captureManifestHash: Sha256Schema,
  featureCutoff: UtcInstantSchema,
  registeredAt: UtcInstantSchema,
  deadlineAt: UtcInstantSchema,
  attempt: NonNegativeIntegerSchema.check(Schema.isLessThanOrEqualTo(10)),
  promptTemplate: Text,
  context: Schema.Struct({
    memory: Schema.Struct({ sha256: Sha256Schema, availableAt: UtcInstantSchema, text: Text }),
  }),
  policy: ResearchPolicySchema,
  costBasis: Schema.NullOr(
    Schema.Struct({
      sourceEvidenceHash: Sha256Schema,
      effectiveFrom: UtcInstantSchema,
      effectiveUntil: UtcInstantSchema,
      allocation: Schema.Literal('reserved-capacity-wall-time'),
      picoUsdPerSecond: UnsignedMicrosSchema,
    }),
  ),
})
export type ResearchRun = typeof ResearchRunSchema.Type
export const ResearchServingIdentitySchema = Schema.Struct({
  model: StrictNonEmptyStringSchema.check(Schema.isMaxLength(160)),
  checkpoint: GitSourceRevisionSchema,
  servingImage: Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/)),
  tokenizerRevision: GitSourceRevisionSchema,
  chatTemplateRevision: GitSourceRevisionSchema,
})
export const researchServingIdentity = (policy: typeof ResearchServingIdentitySchema.Type) => ({
  model: policy.model,
  checkpoint: policy.checkpoint,
  servingImage: policy.servingImage,
  tokenizerRevision: policy.tokenizerRevision,
  chatTemplateRevision: policy.chatTemplateRevision,
})

export const hashResearch = (input: unknown) =>
  canonicalHashV1Result(input).pipe(
    Result.mapError((cause) => new ResearchError({ message: 'Research evidence cannot be hashed', cause })),
  )

export const decodeResearchRun = (input: unknown) =>
  Result.gen(function* () {
    const run = yield* Schema.decodeUnknownResult(
      ResearchRunSchema,
      strictParseOptions,
    )(input).pipe(Result.mapError((cause) => new ResearchError({ message: 'Research run is malformed', cause })))
    if (Buffer.byteLength(JSON.stringify(run)) > 262144)
      return yield* Result.fail(new ResearchError({ message: 'Research registration exceeds 256 KiB' }))
    if (sha256(run.context.memory.text) !== run.context.memory.sha256)
      return yield* Result.fail(
        new ResearchError({ message: 'Research context bytes differ from their retained hash' }),
      )
    if (
      run.registeredAt > run.featureCutoff ||
      run.deadlineAt <= run.featureCutoff ||
      Date.parse(run.deadlineAt) - Date.parse(run.featureCutoff) > 180_000
    )
      return yield* Result.fail(
        new ResearchError({ message: 'Research registration or deadline is outside the decision window' }),
      )
    if (run.context.memory.availableAt > run.featureCutoff)
      return yield* Result.fail(
        new ResearchError({ message: 'Research context contains evidence unavailable at its cutoff' }),
      )
    if (
      run.costBasis !== null &&
      (run.costBasis.effectiveFrom > run.featureCutoff ||
        run.costBasis.effectiveUntil < run.deadlineAt ||
        BigInt(run.costBasis.picoUsdPerSecond) === 0n ||
        BigInt(run.costBasis.picoUsdPerSecond) * 180n >= 2n ** 128n)
    )
      return yield* Result.fail(
        new ResearchError({
          message: 'Research cost basis does not cover the attempt or exceeds its positive ledger allocation bound',
        }),
      )
    return run
  })

export const researchRequest = (run: ResearchRun) => {
  const {
    model,
    temperature,
    top_p,
    top_k,
    min_p,
    seed,
    presence_penalty,
    frequency_penalty,
    repetition_penalty,
    enable_thinking,
    max_tokens,
    stop,
  } = run.policy
  return {
    model,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'bayn_jev_instructions',
        strict: true,
        schema: Schema.toJsonSchemaDocument(JevInstructionsSchema, { onExcessProperty: 'error' }).schema,
      },
    },
    temperature,
    top_p,
    top_k,
    min_p,
    seed,
    presence_penalty,
    frequency_penalty,
    repetition_penalty,
    max_tokens,
    stop,
    chat_template_kwargs: { enable_thinking },
    stream: true,
    stream_options: { include_usage: true },
    n: 1,
    messages: [
      {
        role: 'user',
        content: `${run.promptTemplate}\n\n${run.context.memory.text}\n\nReturn only the complete instruction JSON object with exactly one entry string field. Do not return context wrappers, XML tags, notes or other keys.`,
      },
    ],
  }
}

export enum ResearchOutcome {
  Complete = 'COMPLETE',
  Rejected = 'REJECTED',
  Expired = 'EXPIRED',
  Ambiguous = 'AMBIGUOUS',
  Unavailable = 'UNAVAILABLE',
}
export const ResearchReceiptSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.research-receipt.v2'),
  workerSourceRevision: Schema.NullOr(GitSourceRevisionSchema),
  runId: Sha256Schema,
  requestHash: Sha256Schema,
  startedAtMs: NonNegativeIntegerSchema,
  completedAtMs: NonNegativeIntegerSchema,
  firstTokenAtMs: Schema.NullOr(NonNegativeIntegerSchema),
  outcome: Schema.Enum(ResearchOutcome),
  httpStatus: Schema.NullOr(NonNegativeIntegerSchema),
  servingIdentity: Schema.NullOr(ResearchServingIdentitySchema),
  serverRequestId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(160))),
  responseHash: Schema.NullOr(Sha256Schema),
  responseText: Schema.String.check(Schema.isMaxLength(262144)),
  responseBase64: Schema.String.check(
    Schema.isMaxLength(4 * Math.ceil(maximumResearchStreamBytes / 3)),
    Schema.isPattern(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  ),
  instructions: Schema.NullOr(JevInstructionsSchema),
  usage: Schema.NullOr(
    Schema.Struct({
      prompt_tokens: NonNegativeIntegerSchema,
      completion_tokens: NonNegativeIntegerSchema,
      total_tokens: NonNegativeIntegerSchema,
    }),
  ),
  costPicoUsd: Schema.NullOr(UnsignedMicrosSchema),
  qualification: Schema.Literal('UNQUALIFIED'),
  receiptHash: Sha256Schema,
})
export type ResearchReceipt = typeof ResearchReceiptSchema.Type

export const sealResearchReceipt = (
  run: ResearchRun,
  material: Omit<ResearchReceipt, 'schemaVersion' | 'qualification' | 'receiptHash' | 'costPicoUsd'>,
) =>
  Result.gen(function* () {
    const cost =
      run.costBasis === null || material.outcome !== ResearchOutcome.Complete
        ? null
        : (
            (BigInt(Math.max(0, material.completedAtMs - material.startedAtMs)) *
              BigInt(run.costBasis.picoUsdPerSecond) +
              999n) /
            1000n
          ).toString()
    const receipt = {
      schemaVersion: 'bayn.research-receipt.v2' as const,
      ...material,
      costPicoUsd: cost,
      qualification: 'UNQUALIFIED' as const,
    }
    return { ...receipt, receiptHash: yield* hashResearch(receipt) }
  })

export const parseResearchOutput = (_run: ResearchRun, output: string) =>
  Schema.decodeUnknownResult(
    Schema.fromJsonString(JevInstructionsSchema),
    strictParseOptions,
  )(output).pipe(
    Result.mapError(
      (cause) =>
        new ResearchError({ message: 'Jev editor must return only the native instruction JSON document', cause }),
    ),
  )

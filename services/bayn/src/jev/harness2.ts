import { Result, Schema } from 'effect'

import { canonicalHashV1Result } from '../hash'
import { GitSourceRevisionSchema, Sha256Schema, UtcInstantSchema, strictParseOptions } from '../schemas'
import { JevBatchPlanVersion, JevCandidateExclusionSchema, JevCandidatePlanStatus } from './batch'
import {
  JevContractError,
  JevFailure,
  JevRequestSchema,
  JevResponseSchema,
  decodeJevResponse,
  prepareJevRequest,
  type JevRequest,
} from './contract'
import { selectJevEntryCandidates } from './decision'
import { JevInstructionsSchema, type JevInstructions } from './instructions-contract'
import { reproduceJevCandidateObservation } from './observation'
import { JevObservationSchema } from './observation-contract'
import { JevPurpose } from './portfolio'
import { makeJevTradingSignalBatch } from './trading-signals'
import type { JevInference } from './client'

const HarnessInferenceSchema = Schema.Struct({
  requestHash: Sha256Schema,
  responseHash: Sha256Schema,
  startedAt: UtcInstantSchema,
  completedAt: UtcInstantSchema,
  response: JevResponseSchema,
})
const JevHarnessReceiptSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-harness2-receipt.v2'),
  runId: Sha256Schema,
  sourceRevision: GitSourceRevisionSchema,
  observationHash: Sha256Schema,
  instructionsHash: Sha256Schema,
  startedAtMs: Schema.Int,
  completedAtMs: Schema.Int,
  outcome: Schema.Literals(['COMPLETE', 'INCONCLUSIVE']),
  excludedCandidates: Schema.Array(JevCandidateExclusionSchema),
  requests: Schema.Array(
    Schema.Struct({
      symbol: Schema.String,
      originalRequestHash: Sha256Schema,
      request: JevRequestSchema,
      requestHash: Sha256Schema,
      inference: Schema.NullOr(HarnessInferenceSchema),
      failure: Schema.NullOr(Schema.Enum(JevFailure)),
    }),
  ),
  decision: Schema.Json,
  costPicoUsd: Schema.Null,
  qualification: Schema.Literal('UNQUALIFIED'),
  timingQualification: Schema.Literal('OFFLINE_REEVALUATION'),
  receiptHash: Sha256Schema,
})

export const JevHarnessProbeSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-harness2-probe.v1'),
  sourceRevision: GitSourceRevisionSchema,
  studyId: Sha256Schema,
  registeredAt: UtcInstantSchema,
  deadlineAt: UtcInstantSchema,
  observation: JevObservationSchema,
  instructions: JevInstructionsSchema,
})

export const applyJevInstructions = (request: JevRequest, instructions: JevInstructions) =>
  prepareJevRequest({
    ...request,
    questions: Object.fromEntries(
      Object.entries(request.questions).map(([name, question]) => [
        name,
        {
          ...question,
          instructions: name === 'action' ? instructions.entry : question.instructions,
        },
      ]),
    ),
  })

export const prepareJevHarnessProbe = (input: unknown) =>
  Result.gen(function* () {
    const run = yield* Schema.decodeUnknownResult(JevHarnessProbeSchema, strictParseOptions)(input)
    if (Date.parse(run.deadlineAt) - Date.parse(run.registeredAt) > 180_000 || run.registeredAt >= run.deadlineAt)
      return yield* Result.fail(new JevContractError({ message: 'Harness probe exceeds its bounded inference window' }))
    const observation = yield* reproduceJevCandidateObservation(run.observation)
    if (observation.portfolio.purpose !== JevPurpose.Entry)
      return yield* Result.fail(
        new JevContractError({ message: 'Harness2 refines native entry and protection choices only' }),
      )
    const plan = yield* makeJevTradingSignalBatch({
      observation: run.observation,
      expiresAt: new Date(Date.parse(observation.observedAt) + observation.protocol.inferenceValidityMs).toISOString(),
      planVersion: JevBatchPlanVersion.V6,
    })
    const requests = []
    for (const candidate of plan.candidates) {
      if (candidate.status === JevCandidatePlanStatus.Excluded) continue
      const { symbol, request: original } = candidate
      const prepared = yield* applyJevInstructions(original.request, run.instructions)
      requests.push({ symbol, originalRequestHash: original.requestHash, ...prepared })
    }
    return {
      run,
      observation,
      requests,
      excludedCandidates: plan.candidates.filter((candidate) => candidate.status === JevCandidatePlanStatus.Excluded),
      runId: yield* canonicalHashV1Result(run),
    }
  }).pipe(Result.mapError((cause) => new JevContractError({ message: 'Jev Harness2 probe does not reproduce', cause })))

export const jevHarnessDecision = (
  prepared: Result.Result.Success<ReturnType<typeof prepareJevHarnessProbe>>,
  inferences: readonly { readonly symbol: string; readonly inference: JevInference }[],
) =>
  Result.gen(function* () {
    if (inferences.length !== prepared.requests.length)
      return yield* Result.fail(new JevContractError({ message: 'Incomplete probes cannot produce a Bayn decision' }))
    const { selected, entryPlanRejections } = yield* selectJevEntryCandidates(
      prepared.observation,
      inferences.map((entry) => ({ ...entry, requestId: entry.inference.requestHash })),
      prepared.requests.map((entry) => ({
        symbol: entry.symbol,
        status: JevCandidatePlanStatus.Requested,
        request: { request: entry.request },
      })),
    )
    return { purpose: JevPurpose.Entry, selected, entryPlanRejections }
  })

export const verifyJevHarnessReceipt = (input: unknown, value: unknown) =>
  Result.gen(function* () {
    const prepared = yield* prepareJevHarnessProbe(input)
    const receipt = yield* Schema.decodeUnknownResult(JevHarnessReceiptSchema, strictParseOptions)(value)
    const { receiptHash, ...material } = receipt
    if (
      receiptHash !== (yield* canonicalHashV1Result(material)) ||
      receipt.runId !== prepared.runId ||
      receipt.sourceRevision !== prepared.run.sourceRevision ||
      receipt.observationHash !== prepared.observation.contentHash ||
      receipt.instructionsHash !== (yield* canonicalHashV1Result(prepared.run.instructions)) ||
      receipt.startedAtMs < Date.parse(prepared.run.registeredAt) ||
      receipt.completedAtMs < receipt.startedAtMs ||
      receipt.completedAtMs >= Date.parse(prepared.run.deadlineAt) ||
      (yield* canonicalHashV1Result(receipt.excludedCandidates)) !==
        (yield* canonicalHashV1Result(prepared.excludedCandidates)) ||
      receipt.requests.length !== prepared.requests.length
    )
      return yield* Result.fail(
        new JevContractError({ message: 'Harness receipt identity, timing or coverage differs' }),
      )
    const inferences = []
    for (const [index, row] of receipt.requests.entries()) {
      const original = prepared.requests[index]
      if (
        original === undefined ||
        row.symbol !== original.symbol ||
        row.originalRequestHash !== original.originalRequestHash ||
        row.requestHash !== original.requestHash ||
        (yield* canonicalHashV1Result(row.request)) !== original.requestHash
      )
        return yield* Result.fail(new JevContractError({ message: 'Harness receipt changed the sealed Jev request' }))
      if (row.inference !== null) {
        yield* decodeJevResponse(original.request, row.inference.response)
        if (
          row.failure !== null ||
          row.inference.requestHash !== original.requestHash ||
          row.inference.responseHash !== (yield* canonicalHashV1Result(row.inference.response)) ||
          Date.parse(row.inference.startedAt) < receipt.startedAtMs ||
          row.inference.completedAt < row.inference.startedAt ||
          Date.parse(row.inference.completedAt) - Date.parse(row.inference.startedAt) >= 10_000 ||
          Date.parse(row.inference.completedAt) > receipt.completedAtMs
        )
          return yield* Result.fail(
            new JevContractError({ message: 'Harness inference does not bind its native response' }),
          )
        inferences.push({ symbol: row.symbol, inference: row.inference })
      } else if (row.failure === null)
        return yield* Result.fail(new JevContractError({ message: 'Missing inference must retain its failure' }))
    }
    const decision =
      inferences.length === prepared.requests.length ? yield* jevHarnessDecision(prepared, inferences) : null
    if (
      (yield* canonicalHashV1Result(receipt.decision)) !== (yield* canonicalHashV1Result(decision)) ||
      receipt.outcome !== (decision === null ? 'INCONCLUSIVE' : 'COMPLETE')
    )
      return yield* Result.fail(
        new JevContractError({ message: 'Harness receipt decision differs from native Bayn selection' }),
      )
    return receipt
  })

import { Result, Schema } from 'effect'

import { canonicalHashV1Result } from '../hash'
import { Sha256Schema, SymbolSchema } from '../schemas'
import { JevContractError } from '../jev/contract'
import { JevDecisionEvidenceSchema, reproduceDecisionEvidence } from '../jev/decision'
import { JevPurpose } from '../jev/portfolio'

const unavailable = (message: string) => Result.fail(new JevContractError({ message }))
export const researchManagementExitProbability = 0.65

export enum JevManagementAction {
  Hold = 'HOLD',
  Exit = 'EXIT',
}

export const decideJevManagement = (input: unknown) =>
  Result.gen(function* () {
    const { evidence, observation, inferences } = yield* reproduceDecisionEvidence(input)
    const inference = inferences[0]
    if (observation.portfolio.purpose !== JevPurpose.Manage || inferences.length !== 1 || inference === undefined)
      return yield* unavailable('Management requires the complete held-position inference')
    const answer = inference.inference.response.answers['action']
    if (answer?.type !== 'choice' || answer.probabilities['exit'] === undefined)
      return yield* unavailable('Jev management has no typed exit probability')
    return {
      schemaVersion: 'bayn.jev-management-decision.v1' as const,
      cycleId: observation.cycleId,
      entryDecisionHash: observation.portfolio.entryDecisionHash,
      symbol: inference.symbol,
      action:
        answer.choice === 'exit' && answer.probabilities['exit'] >= researchManagementExitProbability
          ? JevManagementAction.Exit
          : JevManagementAction.Hold,
      evidence,
    }
  }).pipe(
    Result.mapError(
      (cause) => new JevContractError({ message: 'Jev management decision could not be derived', cause }),
    ),
  )

export const JevManagementDecisionSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.jev-management-decision.v1'),
  cycleId: Sha256Schema,
  entryDecisionHash: Sha256Schema,
  symbol: SymbolSchema,
  action: Schema.Enum(JevManagementAction),
  evidence: JevDecisionEvidenceSchema,
}).check(
  Schema.makeFilter((decision) => {
    const { evidence, ...material } = decision
    const reproduced = decideJevManagement(evidence).pipe(
      Result.flatMap(({ evidence: _, ...derived }) => canonicalHashV1Result(derived)),
    )
    const supplied = canonicalHashV1Result(material)
    return Result.isSuccess(reproduced) && Result.isSuccess(supplied) && reproduced.success === supplied.success
      ? []
      : [{ path: ['evidence'], issue: 'recorded held-position evidence must reproduce the exact management decision' }]
  }),
)

export type JevManagementDecision = typeof JevManagementDecisionSchema.Type

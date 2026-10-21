import { continuousExecutionPolicy } from '../market-hours'
import { Result, Schema } from 'effect'

import { canonicalHashV1Result } from '../hash'
import {
  IsoDateSchema,
  NonNegativeIntegerSchema,
  PositiveIntegerSchema,
  Sha256Schema,
  StrictNonEmptyStringSchema,
  UtcInstantSchema,
  strictParseOptions,
} from '../schemas'
import { Pipeable } from '../pipeable'

export const cycleTimeZone = 'America/New_York' as const
export const maximumSubmissionDurationMs = 86_400_000
export const SubmissionWindowMsSchema = PositiveIntegerSchema.check(
  Schema.isLessThanOrEqualTo(maximumSubmissionDurationMs),
)
const SessionBoundaryOffsetMsSchema = NonNegativeIntegerSchema.check(
  Schema.isLessThanOrEqualTo(maximumSubmissionDurationMs),
)

const canonicalHashMatches = (value: unknown, expectedHash: string): boolean => {
  const hash = canonicalHashV1Result(value)
  return Result.isSuccess(hash) && hash.success === expectedHash
}

export enum CycleState {
  Pending = 'PENDING',
  Active = 'ACTIVE',
  Completed = 'COMPLETED',
  NoTrade = 'NO_TRADE',
  Blocked = 'BLOCKED',
}

export type CycleCompletionState = CycleState.Completed | CycleState.NoTrade

export enum CycleTerminalReason {
  MissedPublication = 'BLOCKED_MISSED_PUBLICATION_DEADLINE',
  MissedSubmission = 'BLOCKED_MISSED_SUBMISSION_DEADLINE',
  UnusedEntryExpired = 'BLOCKED_UNUSED_ENTRY_EXPIRED',
  DataUnavailable = 'BLOCKED_DATA_UNAVAILABLE',
  DataStale = 'BLOCKED_DATA_STALE',
  DataInvalid = 'BLOCKED_DATA_INVALID',
  ProvenanceMismatch = 'BLOCKED_PROVENANCE_MISMATCH',
  Authority = 'BLOCKED_AUTHORITY',
  KillActive = 'BLOCKED_KILL_ACTIVE',
  BrokerDisabled = 'BLOCKED_BROKER_DISABLED',
  BrokerUnavailable = 'BLOCKED_BROKER_UNAVAILABLE',
  UnresolvedMutation = 'BLOCKED_UNRESOLVED_MUTATION',
  Reconciliation = 'BLOCKED_RECONCILIATION',
  Risk = 'BLOCKED_RISK',
}

const ExecutionCalendarObservationMaterialBase = Schema.Struct({
  executionCalendarSchemaVersion: Schema.Literals([
    'bayn.alpaca-market-calendar-observation.v2',
    'bayn.continuous-market-hours.v1',
  ]),
  executionCalendarSource: Schema.Literals(['alpaca-v2-calendar', 'alpaca-crypto-us']),
  executionSessionDate: IsoDateSchema,
  executionOpenAt: UtcInstantSchema,
  executionCloseAt: UtcInstantSchema,
})

const executionCalendarMaterialIssues = (
  observation: typeof ExecutionCalendarObservationMaterialBase.Type,
): Schema.FilterIssue[] => {
  const issues: Schema.FilterIssue[] = []
  if (observation.executionOpenAt >= observation.executionCloseAt) {
    issues.push({ path: ['executionCloseAt'], issue: 'must follow the execution session open' })
  }
  if (
    observation.executionCalendarSchemaVersion !== 'bayn.continuous-market-hours.v1' &&
    (!observation.executionOpenAt.startsWith(observation.executionSessionDate) ||
      !observation.executionCloseAt.startsWith(observation.executionSessionDate))
  ) {
    issues.push({ path: ['executionSessionDate'], issue: 'must match the UTC execution session instants' })
  }
  if (
    (observation.executionCalendarSchemaVersion === 'bayn.continuous-market-hours.v1') !==
      (observation.executionCalendarSource === 'alpaca-crypto-us') ||
    !observation.executionOpenAt.startsWith(observation.executionSessionDate)
  )
    issues.push({ path: ['executionCalendarSource'], issue: 'market source and window accounting date must agree' })
  if (
    observation.executionCalendarSchemaVersion === 'bayn.continuous-market-hours.v1' &&
    Date.parse(observation.executionCloseAt) - Date.parse(observation.executionOpenAt) !==
      continuousExecutionPolicy.entryValidityMs +
        continuousExecutionPolicy.maximumHoldingMs +
        continuousExecutionPolicy.closeRecoveryMs
  )
    issues.push({ path: ['executionCloseAt'], issue: 'continuous lease must have the reviewed finite duration' })
  return issues
}

export const ExecutionCalendarObservationMaterialSchema = ExecutionCalendarObservationMaterialBase.check(
  Schema.makeFilter(executionCalendarMaterialIssues),
)
export type ExecutionCalendarObservationMaterial = typeof ExecutionCalendarObservationMaterialSchema.Type

const executionCalendarMaterialOf = (
  observation: ExecutionCalendarObservationMaterial,
): ExecutionCalendarObservationMaterial => ({
  executionCalendarSchemaVersion: observation.executionCalendarSchemaVersion,
  executionCalendarSource: observation.executionCalendarSource,
  executionSessionDate: observation.executionSessionDate,
  executionOpenAt: observation.executionOpenAt,
  executionCloseAt: observation.executionCloseAt,
})

const ExecutionCalendarObservationBase = Schema.Struct({
  ...ExecutionCalendarObservationMaterialBase.fields,
  executionCalendarHash: Sha256Schema,
})

const executionCalendarObservationIssues = (
  observation: typeof ExecutionCalendarObservationBase.Type,
): Schema.FilterIssue[] => {
  const issues = executionCalendarMaterialIssues(observation)
  if (!canonicalHashMatches(executionCalendarMaterialOf(observation), observation.executionCalendarHash)) {
    issues.push({ path: ['executionCalendarHash'], issue: 'must match the selected broker-calendar session' })
  }
  return issues
}

export const ExecutionCalendarObservationSchema = ExecutionCalendarObservationBase.check(
  Schema.makeFilter(executionCalendarObservationIssues),
)
export type ExecutionCalendarObservation = typeof ExecutionCalendarObservationSchema.Type
export type SelectedExecutionCalendarSession = typeof SelectedExecutionCalendarSessionSchema.Type

export const CycleExecutionPolicyMaterialSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.autonomous-cycle-execution-policy.v3'),
  strategyExecutionModelHash: Sha256Schema,
  warmupAfterOpenMs: SessionBoundaryOffsetMsSchema,
  submissionCutoffBeforeCloseMs: SessionBoundaryOffsetMsSchema,
})

export type CycleExecutionPolicyMaterial = typeof CycleExecutionPolicyMaterialSchema.Type
const CycleExecutionPolicyBase = Schema.Struct({
  ...CycleExecutionPolicyMaterialSchema.fields,
  executionPolicyHash: Sha256Schema,
})
export const CycleExecutionPolicySchema = CycleExecutionPolicyBase.check(
  Schema.makeFilter((policy) => {
    const { executionPolicyHash, ...material } = policy
    return canonicalHashMatches(material, executionPolicyHash)
      ? []
      : [{ path: ['executionPolicyHash'], issue: 'must match the canonical execution policy material' }]
  }),
)
export type CycleExecutionPolicy = typeof CycleExecutionPolicySchema.Type

const CycleIdentityExecutionMaterial = {
  qualificationRunId: Sha256Schema,
  strategyProtocolHash: Sha256Schema,
  accountId: StrictNonEmptyStringSchema,
  executionSessionDate: IsoDateSchema,
  executionCalendarSchemaVersion: Schema.Literals([
    'bayn.alpaca-market-calendar-observation.v2',
    'bayn.continuous-market-hours.v1',
  ]),
  executionCalendarSource: Schema.Literals(['alpaca-v2-calendar', 'alpaca-crypto-us']),
  executionCalendarHash: Sha256Schema,
} as const

export const IntradayCycleEntryAttemptOrdinalSchema = PositiveIntegerSchema.check(
  Schema.isLessThanOrEqualTo(2_147_483_647),
)
export type IntradayCycleEntryAttemptOrdinal = typeof IntradayCycleEntryAttemptOrdinalSchema.Type

export const CycleIdentityMaterialSchema = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.autonomous-cycle-identity.v4'),
  strategyName: Schema.Literal('jev'),
  ...CycleIdentityExecutionMaterial,
  entryAttemptOrdinal: IntradayCycleEntryAttemptOrdinalSchema,
  executionPolicy: CycleExecutionPolicySchema,
})

export type CycleIdentityMaterial = typeof CycleIdentityMaterialSchema.Type
const CycleIdentityBase = Schema.Struct({ ...CycleIdentityMaterialSchema.fields, cycleId: Sha256Schema })
export const CycleIdentitySchema = CycleIdentityBase.check(
  Schema.makeFilter((identity) => {
    const { cycleId, ...material } = identity
    return canonicalHashMatches(material, cycleId)
      ? []
      : [{ path: ['cycleId'], issue: 'must match the canonical cycle identity material' }]
  }),
)
export type CycleIdentity = typeof CycleIdentitySchema.Type

const CycleWindowExecutionFields = {
  ...ExecutionCalendarObservationBase.fields,
  submissionOpenAt: UtcInstantSchema,
  submissionCutoffAt: UtcInstantSchema,
} as const

const CycleWindowBase = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.autonomous-cycle-window.v3'),
  ...CycleWindowExecutionFields,
})

export const CycleWindowSchema = CycleWindowBase.check(
  Schema.makeFilter((window) => {
    const issues = executionCalendarObservationIssues(window)
    if (window.submissionOpenAt >= window.submissionCutoffAt)
      issues.push({ path: ['submissionCutoffAt'], issue: 'must follow the submission window open' })
    if (window.executionOpenAt > window.submissionOpenAt || window.submissionCutoffAt > window.executionCloseAt)
      issues.push({ path: ['submissionOpenAt'], issue: 'intraday submission must remain within the execution session' })
    if (window.executionOpenAt >= window.executionCloseAt)
      issues.push({ path: ['executionCloseAt'], issue: 'must follow execution open' })
    return issues
  }),
)
export type CycleWindow = typeof CycleWindowSchema.Type
const CycleDraftBase = Schema.Struct({
  schemaVersion: Schema.Literal('bayn.autonomous-cycle.v4'),
  identity: CycleIdentitySchema,
  window: CycleWindowSchema,
})
const cycleDraftIssues = (draft: typeof CycleDraftBase.Type): readonly Schema.FilterIssue[] => {
  const issues: Schema.FilterIssue[] = []
  for (const field of [
    'executionSessionDate',
    'executionCalendarSchemaVersion',
    'executionCalendarSource',
    'executionCalendarHash',
  ] as const)
    if (draft.identity[field] !== draft.window[field])
      issues.push({ path: ['window', field], issue: 'must match the cycle identity' })
  const policy = draft.identity.executionPolicy
  const continuous = draft.window.executionCalendarSchemaVersion === 'bayn.continuous-market-hours.v1'
  const expectedOpen = Date.parse(draft.window.executionOpenAt) + (continuous ? 0 : policy.warmupAfterOpenMs)
  const expectedCutoff = continuous
    ? Date.parse(draft.window.executionOpenAt) + continuousExecutionPolicy.entryValidityMs
    : Date.parse(draft.window.executionCloseAt) - policy.submissionCutoffBeforeCloseMs
  if (Date.parse(draft.window.submissionOpenAt) !== expectedOpen)
    issues.push({
      path: ['window', 'submissionOpenAt'],
      issue: 'must equal execution open plus the bound intraday warmup',
    })
  if (Date.parse(draft.window.submissionCutoffAt) !== expectedCutoff)
    issues.push({
      path: ['window', 'submissionCutoffAt'],
      issue: 'must equal execution close minus the bound intraday cutoff lead',
    })
  return issues
}

export const CycleDraftSchema = CycleDraftBase.check(Schema.makeFilter(cycleDraftIssues))
export type CycleDraft = typeof CycleDraftSchema.Type

const CycleBindingsSchema = Schema.Struct({
  snapshotId: Schema.optionalKey(Sha256Schema),
  decisionHash: Schema.optionalKey(Sha256Schema),
})
export type CycleBindings = typeof CycleBindingsSchema.Type

const AutonomousCycleBase = Schema.Struct({
  ...CycleDraftBase.fields,
  state: Schema.Enum(CycleState),
  bindings: CycleBindingsSchema,
  terminalReason: Schema.optionalKey(Schema.Enum(CycleTerminalReason)),
  stateVersion: PositiveIntegerSchema,
  createdAt: UtcInstantSchema,
  updatedAt: UtcInstantSchema,
  terminalAt: Schema.optionalKey(UtcInstantSchema),
})

export const AutonomousCycleSchema = AutonomousCycleBase.check(
  Schema.makeFilter((cycle) => {
    const issues = [...cycleDraftIssues(cycle)]
    if (cycle.updatedAt < cycle.createdAt) {
      issues.push({ path: ['updatedAt'], issue: 'must not precede cycle creation' })
    }
    if (cycle.bindings.decisionHash !== undefined && cycle.bindings.snapshotId === undefined) {
      issues.push({ path: ['bindings', 'decisionHash'], issue: 'requires a bound snapshot' })
    }
    switch (cycle.state) {
      case CycleState.Pending:
        if (
          cycle.bindings.decisionHash !== undefined ||
          cycle.terminalReason !== undefined ||
          cycle.terminalAt !== undefined
        ) {
          issues.push({ path: ['state'], issue: 'PENDING permits only an optional snapshot binding' })
        }
        break
      case CycleState.Active:
        if (cycle.terminalReason !== undefined || cycle.terminalAt !== undefined) {
          issues.push({
            path: ['state'],
            issue: 'ACTIVE permits an unbound cycle and no terminal fields',
          })
        }
        break
      case CycleState.Completed:
        if (
          cycle.bindings.snapshotId === undefined ||
          cycle.bindings.decisionHash === undefined ||
          cycle.terminalReason !== undefined ||
          cycle.terminalAt === undefined
        ) {
          issues.push({ path: ['state'], issue: 'COMPLETED requires a bound decision and terminal time' })
        }
        break
      case CycleState.NoTrade:
        if (
          cycle.bindings.snapshotId === undefined ||
          cycle.bindings.decisionHash === undefined ||
          cycle.terminalReason !== undefined ||
          cycle.terminalAt === undefined
        ) {
          issues.push({ path: ['state'], issue: 'NO_TRADE requires a bound decision and terminal time' })
        }
        break
      case CycleState.Blocked:
        if (cycle.terminalReason === undefined || cycle.terminalAt === undefined) {
          issues.push({ path: ['state'], issue: 'BLOCKED requires its durable reason and terminal time' })
        }
        break
    }
    if (cycle.terminalAt !== undefined && cycle.terminalAt !== cycle.updatedAt) {
      issues.push({ path: ['terminalAt'], issue: 'must equal the terminal state update time' })
    }
    return issues
  }),
)
export type AutonomousCycle = typeof AutonomousCycleSchema.Type

type AutonomousCycleVariantBase = Omit<AutonomousCycle, 'bindings' | 'state' | 'terminalAt' | 'terminalReason'>
type PendingCycleBindings =
  | { readonly snapshotId?: undefined; readonly decisionHash?: undefined }
  | { readonly snapshotId: string; readonly decisionHash?: undefined }
type TerminalCycleBindings = PendingCycleBindings | { readonly snapshotId: string; readonly decisionHash: string }
export type PendingCycle = AutonomousCycleVariantBase & {
  readonly state: CycleState.Pending
  readonly bindings: PendingCycleBindings
  readonly terminalReason?: undefined
  readonly terminalAt?: undefined
}
export type ActiveUnboundCycle = AutonomousCycleVariantBase & {
  readonly state: CycleState.Active
  readonly bindings: PendingCycleBindings
  readonly terminalReason?: undefined
  readonly terminalAt?: undefined
}
export type ActiveDecisionBoundCycle = AutonomousCycleVariantBase & {
  readonly state: CycleState.Active
  readonly bindings: { readonly snapshotId: string; readonly decisionHash: string }
  readonly terminalReason?: undefined
  readonly terminalAt?: undefined
}
export type CompletedCycle = AutonomousCycleVariantBase & {
  readonly state: CycleCompletionState
  readonly bindings: { readonly snapshotId: string; readonly decisionHash: string }
  readonly terminalReason?: undefined
  readonly terminalAt: string
}
export type BlockedCycle = AutonomousCycleVariantBase & {
  readonly state: CycleState.Blocked
  readonly bindings: TerminalCycleBindings
  readonly terminalReason: CycleTerminalReason
  readonly terminalAt: string
}
export type CorrelatedAutonomousCycle =
  | PendingCycle
  | ActiveUnboundCycle
  | ActiveDecisionBoundCycle
  | CompletedCycle
  | BlockedCycle

export const SelectedExecutionCalendarSessionSchema = Schema.Struct({
  schemaVersion: Schema.Literals(['bayn.alpaca-market-calendar-observation.v2', 'bayn.continuous-market-hours.v1']),
  source: Schema.Literals(['alpaca-v2-calendar', 'alpaca-crypto-us']),
  date: IsoDateSchema,
  openAt: UtcInstantSchema,
  closeAt: UtcInstantSchema,
})

export const CycleWindowPolicyInputSchema = Schema.Union([
  CycleExecutionPolicySchema,
  Schema.Struct({ warmupAfterOpenMs: Schema.Finite, submissionCutoffBeforeCloseMs: Schema.Finite }),
])
export type CycleWindowPolicyInput = typeof CycleWindowPolicyInputSchema.Type

const decodeExecutionCalendarMaterialResultDataFirst = Schema.decodeUnknownResult(
  ExecutionCalendarObservationMaterialSchema,
  strictParseOptions,
)

export const decodeExecutionCalendarMaterialResult = Pipeable.dual(1, (input: unknown) =>
  decodeExecutionCalendarMaterialResultDataFirst(input),
)
const decodeExecutionCalendarObservationResultDataFirst = Schema.decodeUnknownResult(
  ExecutionCalendarObservationSchema,
  strictParseOptions,
)

export const decodeExecutionCalendarObservationResult = Pipeable.dual(1, (input: unknown) =>
  decodeExecutionCalendarObservationResultDataFirst(input),
)
const decodeCycleWindowPolicyInputResultDataFirst = Schema.decodeUnknownResult(
  CycleWindowPolicyInputSchema,
  strictParseOptions,
)

export const decodeCycleWindowPolicyInputResult = Pipeable.dual(1, (input: unknown) =>
  decodeCycleWindowPolicyInputResultDataFirst(input),
)
const decodeCycleExecutionPolicyMaterialResultDataFirst = Schema.decodeUnknownResult(
  CycleExecutionPolicyMaterialSchema,
  strictParseOptions,
)

export const decodeCycleExecutionPolicyMaterialResult = Pipeable.dual(1, (input: unknown) =>
  decodeCycleExecutionPolicyMaterialResultDataFirst(input),
)
const decodeCycleExecutionPolicyResultDataFirst = Schema.decodeUnknownResult(
  CycleExecutionPolicySchema,
  strictParseOptions,
)

export const decodeCycleExecutionPolicyResult = Pipeable.dual(1, (input: unknown) =>
  decodeCycleExecutionPolicyResultDataFirst(input),
)
const decodeCycleIdentityMaterialResultDataFirst = Schema.decodeUnknownResult(
  CycleIdentityMaterialSchema,
  strictParseOptions,
)

export const decodeCycleIdentityMaterialResult = Pipeable.dual(1, (input: unknown) =>
  decodeCycleIdentityMaterialResultDataFirst(input),
)
const decodeCycleIdentityResultDataFirst = Schema.decodeUnknownResult(CycleIdentitySchema, strictParseOptions)

export const decodeCycleIdentityResult = Pipeable.dual(1, (input: unknown) => decodeCycleIdentityResultDataFirst(input))
const decodeCycleWindowResultDataFirst = Schema.decodeUnknownResult(CycleWindowSchema, strictParseOptions)

export const decodeCycleWindowResult = Pipeable.dual(1, (input: unknown) => decodeCycleWindowResultDataFirst(input))
const decodeCycleDraftResultDataFirst = Schema.decodeUnknownResult(CycleDraftSchema, strictParseOptions)

export const decodeCycleDraftResult = Pipeable.dual(1, (input: unknown) => decodeCycleDraftResultDataFirst(input))

const decodeExecutionCalendarObservationDataFirst = Schema.decodeUnknownEffect(
  ExecutionCalendarObservationSchema,
  strictParseOptions,
)

export const decodeExecutionCalendarObservation = Pipeable.dual(1, (input: unknown) =>
  decodeExecutionCalendarObservationDataFirst(input),
)
const decodeCycleExecutionPolicyDataFirst = Schema.decodeUnknownEffect(CycleExecutionPolicySchema, strictParseOptions)

export const decodeCycleExecutionPolicy = Pipeable.dual(1, (input: unknown) =>
  decodeCycleExecutionPolicyDataFirst(input),
)
const decodeCycleIdentityDataFirst = Schema.decodeUnknownEffect(CycleIdentitySchema, strictParseOptions)

export const decodeCycleIdentity = Pipeable.dual(1, (input: unknown) => decodeCycleIdentityDataFirst(input))
const decodeCycleWindowDataFirst = Schema.decodeUnknownEffect(CycleWindowSchema, strictParseOptions)

export const decodeCycleWindow = Pipeable.dual(1, (input: unknown) => decodeCycleWindowDataFirst(input))
const decodeCycleDraftDataFirst = Schema.decodeUnknownEffect(CycleDraftSchema, strictParseOptions)

export const decodeCycleDraft = Pipeable.dual(1, (input: unknown) => decodeCycleDraftDataFirst(input))
const decodeAutonomousCycleDataFirst = Schema.decodeUnknownEffect(AutonomousCycleSchema, strictParseOptions)

export const decodeAutonomousCycle = Pipeable.dual(1, (input: unknown) => decodeAutonomousCycleDataFirst(input))

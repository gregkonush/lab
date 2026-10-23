import { expect, test } from 'bun:test'
import { Redacted, Result } from 'effect'
import { approveResearchRun, decodeApprovedResearchRun } from './approval'
import { researchFixture } from './test-support'
import { decodeResearchRun, HarnessPurpose } from './contract'

test('operator approval binds the complete run and denies changed inputs, keys and envelopes', () => {
  const run = researchFixture()
  const key = Redacted.make('7'.repeat(64))
  const approval = Result.getOrThrow(approveResearchRun(run, key))
  expect(Result.getOrThrow(decodeApprovedResearchRun({ run, approval }, key))).toEqual(run)
  expect(Result.isFailure(decodeApprovedResearchRun({ run, approval }, Redacted.make('8'.repeat(64))))).toBe(true)
  expect(Result.isFailure(decodeApprovedResearchRun({ run: { ...run, attempt: 1 }, approval }, key))).toBe(true)
  expect(Result.isFailure(decodeApprovedResearchRun({ run, approval, extra: true }, key))).toBe(true)
  expect(Result.isFailure(approveResearchRun(run, Redacted.make('short')))).toBe(true)
  const edit = Result.getOrThrow(
    decodeResearchRun({ ...run, schemaVersion: 'bayn.harness2-inference.v1', purpose: HarnessPurpose.PromptEdit }),
  )
  const editApproval = Result.getOrThrow(approveResearchRun(edit, key))
  expect(Result.getOrThrow(decodeApprovedResearchRun({ run: edit, approval: editApproval }, key))).toEqual(edit)
  expect(Result.isFailure(decodeApprovedResearchRun({ run: edit, approval }, key))).toBe(true)
  expect(
    Result.isFailure(
      decodeApprovedResearchRun({ run: { ...edit, purpose: HarnessPurpose.Reflection }, approval: editApproval }, key),
    ),
  ).toBe(true)
})

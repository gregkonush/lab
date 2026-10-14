import { Result, pipe } from 'effect'

import type { ExecutionModel } from '../../execution-model-contract'
import type { IsoDate } from '../../schemas'
import { ensureUnsigned, fail, quantizeDown, roundDiv, scaledNumber, type ExecutionResult } from './fixed-point'
import { BPS, MICROS, PPM } from './model'
import { Pipeable } from '../../pipeable'

const accrueCashYieldDataFirst = (
  cashMicros: bigint,
  elapsedDays: number,
  model: ExecutionModel,
): ExecutionResult<bigint> => {
  if (cashMicros < 0n) {
    return fail({ _tag: 'InvalidCashYield', cashMicros, elapsedDays, reason: 'negative-cash' })
  }
  if (!Number.isInteger(elapsedDays) || elapsedDays < 0) {
    return fail({ _tag: 'InvalidCashYield', cashMicros, elapsedDays, reason: 'invalid-elapsed-days' })
  }
  return pipe(
    scaledNumber(model.cash.annualYieldBps, 'annual cash yield basis points'),
    Result.map((annualYieldBps) => (cashMicros * annualYieldBps * BigInt(elapsedDays)) / (BPS * MICROS * 365n)),
  )
}

export const accrueCashYield = Pipeable.dual(3, accrueCashYieldDataFirst)

const elapsedCalendarDaysDataFirst = (from: IsoDate, to: IsoDate): ExecutionResult<number> => {
  const fromTime = Date.parse(`${from}T00:00:00Z`)
  const toTime = Date.parse(`${to}T00:00:00Z`)
  return !Number.isFinite(fromTime) || !Number.isFinite(toTime) || toTime < fromTime
    ? fail({ _tag: 'InvalidCashAccrualPeriod', from, to })
    : Result.succeed((toTime - fromTime) / 86_400_000)
}

export const elapsedCalendarDays = Pipeable.dual(2, elapsedCalendarDaysDataFirst)

const saleCostBasisMicrosDataFirst = (
  positionCostBasisMicros: bigint,
  soldQuantityAtoms: bigint,
  positionQuantityAtoms: bigint,
): ExecutionResult<bigint> => {
  if (positionCostBasisMicros < 0n || soldQuantityAtoms < 0n || positionQuantityAtoms <= 0n) {
    return fail({
      _tag: 'InvalidSaleCostBasis',
      positionCostBasisMicros,
      soldQuantityAtoms,
      positionQuantityAtoms,
      reason: 'invalid-position',
    })
  }
  if (soldQuantityAtoms > positionQuantityAtoms) {
    return fail({
      _tag: 'InvalidSaleCostBasis',
      positionCostBasisMicros,
      soldQuantityAtoms,
      positionQuantityAtoms,
      reason: 'quantity-exceeds-position',
    })
  }
  return roundDiv(positionCostBasisMicros * soldQuantityAtoms, positionQuantityAtoms)
}

export const saleCostBasisMicros = Pipeable.dual(3, saleCostBasisMicrosDataFirst)

const scaleQuantityAtomsDataFirst = (
  quantityAtoms: bigint,
  scalePpm: bigint,
  model: ExecutionModel,
): ExecutionResult<bigint> => {
  if (scalePpm < 0n || scalePpm > PPM) {
    return fail({
      _tag: 'InvalidQuantityScale',
      quantityAtoms,
      scalePpm,
      minimumScalePpm: 0n,
      maximumScalePpm: PPM,
    })
  }
  return pipe(
    ensureUnsigned(model.precision.quantityIncrementAtoms, 'quantity increment'),
    Result.flatMap((increment) => quantizeDown((quantityAtoms * scalePpm) / PPM, increment)),
  )
}

export const scaleQuantityAtoms = Pipeable.dual(3, scaleQuantityAtomsDataFirst)

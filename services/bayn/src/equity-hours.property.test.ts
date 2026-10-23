import { expect, test } from 'bun:test'
import { Result, Schema } from 'effect'
import fc from 'fast-check'

import { MarketCalendarResponseSchema } from './broker/alpaca/model'
import { normalizeMarketCalendarResult } from './broker/alpaca/normalizers'
import { equityClockSession, equityDataSession, equityFeatureSegmentStartMs } from './equity-hours'
import { canonicalHashV1Result } from './hash'
import { marketHoursAreCanonical, executionCloseRecoveryExpiry } from './market-hours'
import { IsoDateSchema } from './schemas'
import { checkProperty } from './testing/property-test-support'

const calendar = (date: string, close = '16:00', sessionClose = '2000') => {
  const day = Schema.decodeUnknownSync(IsoDateSchema)(date)
  const raw = Schema.decodeUnknownSync(MarketCalendarResponseSchema)([
    { date, open: '09:30', close, session_open: '0400', session_close: sessionClose },
  ])
  return Result.getOrThrow(normalizeMarketCalendarResult(raw, { start: day, end: day }))
}

test('property: recovery leases stay inside the verified broker session after IEX stops', () => {
  checkProperty(
    'equity-close-recovery',
    fc.property(fc.integer({ min: 0, max: 179 * 60 + 59 }), (seconds) => {
      const hours = calendar('2026-10-16')
      const observed = Date.parse('2026-10-16T21:00:00.000Z') + seconds * 1000
      const expires = executionCloseRecoveryExpiry(hours, new Date(observed).toISOString())
      expect(expires).not.toBeNull()
      expect(Date.parse(expires ?? '')).toBeGreaterThan(observed)
      expect(Date.parse(expires ?? '')).toBeLessThanOrEqual(observed + 180_000)
      expect(Date.parse(expires ?? '')).toBeLessThanOrEqual(Date.parse('2026-10-17T00:00:00.000Z'))
      expect(executionCloseRecoveryExpiry(hours, '2026-10-17T00:00:00.000Z')).toBeNull()
      expect(executionCloseRecoveryExpiry(hours, '2026-10-17T12:00:00.000Z')).toBeNull()
      expect(
        executionCloseRecoveryExpiry(calendar('2026-11-27', '13:00', '1700'), '2026-11-27T22:00:00.000Z'),
      ).toBeNull()
      expect(executionCloseRecoveryExpiry(calendar('2026-11-02'), '2026-11-03T00:59:59.000Z')).toBe(
        '2026-11-03T01:00:00.000Z',
      )
    }),
  )
})

test.each([
  ['2026-10-16', '2026-10-16T12:00:00.000Z', '2026-10-16T21:00:00.000Z'],
  ['2026-11-02', '2026-11-02T13:00:00.000Z', '2026-11-02T22:00:00.000Z'],
])('Basic equity hours retain actual provider bounds across DST: %s', (date, openAt, closeAt) => {
  const observed = calendar(date)
  expect(observed.sessions).toEqual([{ date, openAt, closeAt }])
  expect(observed.providerSessions).toHaveLength(1)
  expect(marketHoursAreCanonical(observed)).toBe(true)
  expect(observed.providerSessions[0]?.regularCloseAt).not.toBe(closeAt)
})

test('an early regular close retains Alpaca extended trading until the provider session ends', () => {
  const observed = calendar('2026-11-27', '13:00', '1700')
  expect(observed.sessions[0]).toEqual({
    date: '2026-11-27',
    openAt: '2026-11-27T13:00:00.000Z',
    closeAt: '2026-11-27T22:00:00.000Z',
  })
  expect(observed.providerSessions[0]?.regularCloseAt).toBe('2026-11-27T18:00:00.000Z')
})

test('missing provider hours and forged selected hours cannot authorize an equity session', () => {
  expect(
    Schema.decodeUnknownResult(MarketCalendarResponseSchema)([{ date: '2026-10-16', open: '09:30', close: '16:00' }])
      ._tag,
  ).toBe('Failure')
  const { normalizedResponseHash: _hash, ...original } = calendar('2026-10-16')
  const material = {
    ...original,
    sessions: [
      { date: original.sessions[0]?.date, openAt: '2026-10-16T08:00:00.000Z', closeAt: '2026-10-16T21:00:00.000Z' },
    ],
  }
  expect(
    marketHoursAreCanonical({
      ...original,
      sessions: [{ ...original.sessions[0]!, openAt: material.sessions[0]!.openAt }],
      normalizedResponseHash: Result.getOrThrow(canonicalHashV1Result(material)),
    }),
  ).toBe(false)
})

test('first completed minutes reset computation at 08:00, 09:30 and 16:00 without a thirty-minute admission delay', () => {
  for (const [instant, phase, segment] of [
    ['2026-10-16T12:00:00.000Z', 'pre', '2026-10-16T12:00:00.000Z'],
    ['2026-10-16T13:30:00.000Z', 'regular', '2026-10-16T13:30:00.000Z'],
    ['2026-10-16T20:00:00.000Z', 'post', '2026-10-16T20:00:00.000Z'],
  ] as const) {
    expect(equityClockSession(instant)).toBe(phase)
    expect(equityFeatureSegmentStartMs(Date.parse(instant))).toBe(Date.parse(segment))
  }
  expect(equityClockSession('2026-10-16T11:59:59.999Z')).toBeNull()
  expect(equityClockSession('2026-10-16T21:00:00.000Z')).toBeNull()
})

test('property: provider intervals intersect the entitled data interval and preserve every boundary', () => {
  checkProperty(
    'equity-entitled-session-intersection',
    fc.property(
      fc.integer({ min: 0, max: 480 }),
      fc.integer({ min: 960, max: 1200 }),
      (providerOpen, providerClose) => {
        const at = (minute: number) => new Date(Date.UTC(2026, 9, 16, 4, minute)).toISOString()
        const source = {
          date: '2026-10-16',
          regularOpenAt: at(570),
          regularCloseAt: at(960),
          sessionOpenAt: at(providerOpen),
          sessionCloseAt: at(providerClose),
        }
        const selected = Result.getOrThrow(equityDataSession(source))
        expect(selected.openAt).toBe(at(480))
        expect(selected.closeAt).toBe(at(Math.min(1020, providerClose)))
        expect(selected.openAt >= source.sessionOpenAt && selected.closeAt <= source.sessionCloseAt).toBe(true)
      },
    ),
  )
})

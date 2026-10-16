import { describe, expect, spyOn, test } from 'bun:test'
import * as Sentry from '@sentry/node'
import { Cause, Effect, Exit } from 'effect'

import {
  initializeErrorTracking,
  reportReconciliationState,
  reportTerminalFailure,
  sanitizeErrorEvent,
} from './error-tracking'
import { DiscrepancyKind, ReconciliationStatus, type Reconciliation } from './execution/contracts'

describe('GlitchTip error-only safety boundary', () => {
  test('disabled if DSN is missing', () => {
    expect(initializeErrorTracking('bayn', {})).toBe(false)
  })

  test('rejects dashed UUID keys instead of silently dropping events', () => {
    expect(() =>
      initializeErrorTracking('bayn', {
        BAYN_GLITCHTIP_DSN: 'http://591bd90b-e7b8-4b22-856e-c7c1bd456ec2@glitchtip-web.glitchtip.svc.cluster.local/1',
      }),
    ).toThrow('invalid project key')
  })

  test('disables runtime tracing injection and flushes terminal failures before propagating them', async () => {
    initializeErrorTracking('bayn-test', {
      BAYN_GLITCHTIP_DSN: 'http://591bd90be7b84b22856ec7c1bd456ec2@glitchtip-web.glitchtip.svc.cluster.local/1',
    })
    expect(Sentry.getClient<Sentry.NodeClient>()?.getOptions().enableRuntimeChannelInjection).toBe(false)
    expect(Sentry.getClient<Sentry.NodeClient>()?.getOptions().enableOpenTelemetrySetup).toBe(false)
    const capture = spyOn(Sentry, 'captureException').mockReturnValue('a'.repeat(32))
    let releaseFlush: ((value: boolean) => void) | undefined
    const flush = spyOn(Sentry, 'flush').mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          releaseFlush = resolve
        }),
    )
    const original = new Error('private runtime details')
    let completed = false
    try {
      const result = Effect.runPromiseExit(Effect.fail(original).pipe(reportTerminalFailure('bayn-test'))).then(
        (exit) => {
          completed = true
          return exit
        },
      )
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(capture).toHaveBeenCalledTimes(1)
      expect(flush).toHaveBeenCalledWith(3_000)
      expect(completed).toBe(false)
      releaseFlush?.(true)
      const exit = await result
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(original)
      await Effect.runPromiseExit(Effect.interrupt.pipe(reportTerminalFailure('bayn-test')))
      expect(capture).toHaveBeenCalledTimes(1)
      expect(flush).toHaveBeenCalledTimes(1)
    } finally {
      releaseFlush?.(true)
      capture.mockRestore()
      flush.mockRestore()
    }
  })

  test('reports a committed trading restriction once, including after restart, and reopens after recovery', () => {
    initializeErrorTracking('bayn-test', {
      BAYN_GLITCHTIP_DSN: 'http://591bd90be7b84b22856ec7c1bd456ec2@glitchtip-web.glitchtip.svc.cluster.local/1',
    })
    const capture = spyOn(Sentry, 'captureException').mockReturnValue('b'.repeat(32))
    const reconciliation: Reconciliation = {
      schemaVersion: 'bayn.paper-reconciliation.v1',
      reconciliationId: 'a'.repeat(64),
      accountId: 'private-account',
      expectedHash: 'b'.repeat(64),
      observedHash: 'c'.repeat(64),
      contentHash: 'd'.repeat(64),
      status: ReconciliationStatus.Discrepancy,
      reconciledAt: '2026-10-16T07:12:00.000Z',
      discrepancies: [
        {
          discrepancyId: 'e'.repeat(64),
          kind: DiscrepancyKind.Cash,
          identity: 'private-account',
          expected: '100005570000',
          observed: '100007970000',
          evidenceHash: 'f'.repeat(64),
          firstObservedAt: '2026-10-16T07:10:11.917Z',
          lastObservedAt: '2026-10-16T07:10:11.917Z',
        },
      ],
    }
    try {
      reportReconciliationState(reconciliation)
      reportReconciliationState({ ...reconciliation, reconciliationId: 'f'.repeat(64) })
      expect(capture).toHaveBeenCalledTimes(1)
      expect(capture.mock.calls[0]?.[0]).toMatchObject({ name: 'ReconciliationDiscrepancyError' })
      expect(JSON.stringify(capture.mock.calls)).not.toContain('private-account')
      expect(JSON.stringify(capture.mock.calls)).not.toContain('100007970000')
      reportReconciliationState({ ...reconciliation, status: ReconciliationStatus.Exact, discrepancies: [] })
      reportReconciliationState(reconciliation)
      expect(capture).toHaveBeenCalledTimes(2)
    } finally {
      reportReconciliationState({ ...reconciliation, status: ReconciliationStatus.Exact, discrepancies: [] })
      capture.mockRestore()
    }
  })

  test('an unavailable error collector preserves the original terminal failure', async () => {
    initializeErrorTracking('bayn-test', {
      BAYN_GLITCHTIP_DSN: 'http://591bd90be7b84b22856ec7c1bd456ec2@glitchtip-web.glitchtip.svc.cluster.local/1',
    })
    const capture = spyOn(Sentry, 'captureException').mockReturnValue('c'.repeat(32))
    const flush = spyOn(Sentry, 'flush').mockRejectedValue(new Error('collector unavailable'))
    const original = new Error('original application failure')
    try {
      const exit = await Effect.runPromiseExit(Effect.fail(original).pipe(reportTerminalFailure('bayn-test')))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.squash(exit.cause)).toBe(original)
    } finally {
      capture.mockRestore()
      flush.mockRestore()
    }
  })

  test('redacts potentially sensitive exception data but retains frames', () => {
    const event = sanitizeErrorEvent({
      type: undefined,
      message: 'broker account=secret',
      user: { id: 'customer-id' },
      request: { url: 'https://secret.example/?token=private' },
      breadcrumbs: [{ message: 'broker credentials here' }],
      extra: { account: 'private' },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'broker key is private',
            stacktrace: {
              frames: [
                {
                  filename: 'strategy.ts',
                  lineno: 31,
                  function: 'evaluate',
                  vars: { key: 'secret' },
                  context_line: 'key=secret',
                },
              ],
            },
          },
        ],
      },
    })
    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('secret')
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('customer-id')
    expect(event.message).toBe('Bayn application exception')
    expect(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.function).toBe('evaluate')
  })
})

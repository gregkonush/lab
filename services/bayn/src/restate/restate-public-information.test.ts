import { describe, expect, test } from 'bun:test'
import type { Context, ObjectContext } from '@restatedev/restate-sdk'
import { Redacted } from 'effect'
import { PublicInformationSource, publicInformationIntervalMs, type PublicInformationRun } from '../public-information'
import {
  approvePublicInformation,
  makePublicInformationServices,
  type PublicInformationRuntime,
} from './restate-public-information'

const revision = 'a'.repeat(40)
const key = Redacted.make('b'.repeat(64))
const run = (source: PublicInformationSource): PublicInformationRun => ({
  schemaVersion: 'bayn.public-information-run.v1',
  source,
  sourceRevision: revision,
  completedAt: '1970-01-01T00:00:01.000Z',
  artifacts: [],
  missingIssuerSymbols: [],
  unavailableCompanyFacts: [],
  failures: [],
})
const harness = (
  runtime: PublicInformationRuntime,
  source = PublicInformationSource.Filings,
  sourceRevision = revision,
  durable = new Map<string, unknown>(),
) => {
  const sends: { service: string; parameter: unknown; delay: { milliseconds: number } }[] = []
  const calls: { service: string; method: string; key: string; parameter: unknown }[] = []
  const services = makePublicInformationServices(
    { sourceRevision, approvalKey: key, intervalMs: publicInformationIntervalMs },
    runtime,
  )
  const handlers = (
    services[0] as unknown as {
      object: {
        activate: (ctx: ObjectContext, input: unknown) => Promise<unknown>
        poll: (ctx: ObjectContext, input: unknown) => Promise<void>
      }
    }
  ).object
  const control = (
    services[1] as unknown as { service: { activate: (ctx: Context, input: unknown) => Promise<unknown> } }
  ).service
  const ctx = {
    key: source,
    get: async (key: string) => durable.get(key) ?? null,
    set: (key: string, value: unknown) => durable.set(key, value),
    date: { now: async () => 1000 },
    console: { warn: () => undefined },
    request: () => ({ attemptCompletedSignal: new AbortController().signal }),
    run: async (_: string, action: () => Promise<unknown>) => action(),
    genericSend: (send: (typeof sends)[number]) => {
      sends.push(send)
    },
    genericCall: async (call: (typeof calls)[number]) => {
      calls.push(call)
      return { activated: true }
    },
  } as unknown as ObjectContext
  return { handlers, control, ctx, sends, calls, durable }
}

describe('independent Restate public information jobs', () => {
  test('activation schedules collection without awaiting or calling it', async () => {
    let captures = 0
    const h = harness({
      collect: async (source) => {
        captures += 1
        return run(source)
      },
    })
    await h.handlers.activate(h.ctx, { source: PublicInformationSource.Filings, sourceRevision: revision })
    expect(captures).toBe(0)
    expect(h.sends).toHaveLength(1)
    expect(h.sends[0]?.service).toBe('BaynPublicInformation')
    expect(h.sends[0]?.delay.milliseconds).toBe(0)
  })
  test('failure stays in its source job and both jobs retain scheduled successors', async () => {
    const runtime: PublicInformationRuntime = {
      collect: async (source) => {
        if (source === PublicInformationSource.Filings) throw new Error('injected upload failure')
        return run(source)
      },
    }
    const filings = harness(runtime)
    const macro = harness(runtime, PublicInformationSource.Macro)
    for (const h of [filings, macro]) await h.handlers.activate(h.ctx, { source: h.ctx.key, sourceRevision: revision })
    await Promise.all([filings, macro].map((h) => h.handlers.poll(h.ctx, h.sends[0]?.parameter)))
    expect(filings.durable.get('state')).toMatchObject({
      sequence: 2,
      lastRun: null,
      lastFailureAt: '1970-01-01T00:00:01.000Z',
    })
    expect(macro.durable.get('state')).toMatchObject({
      sequence: 2,
      lastRun: run(PublicInformationSource.Macro),
      lastFailureAt: null,
    })
    expect(filings.sends[1]?.delay.milliseconds).toBe(15 * 60_000)
    expect(macro.sends[1]?.delay.milliseconds).toBe(60 * 60_000)
    expect(filings.calls).toEqual([])
    expect(macro.calls).toEqual([])
  })
  test('a failed refresh retains the last successful artifacts and duplicate ticks issue no work', async () => {
    let broken = false
    let calls = 0
    const h = harness({
      collect: async (source) => {
        calls += 1
        if (broken) throw new Error('source unavailable')
        return run(source)
      },
    })
    await h.handlers.activate(h.ctx, { source: h.ctx.key, sourceRevision: revision })
    await h.handlers.poll(h.ctx, h.sends[0]?.parameter)
    broken = true
    await h.handlers.poll(h.ctx, h.sends[1]?.parameter)
    await h.handlers.poll(h.ctx, h.sends[1]?.parameter)
    expect(calls).toBe(2)
    expect(h.sends).toHaveLength(3)
    expect(h.durable.get('state')).toMatchObject({ lastRun: run(PublicInformationSource.Filings), sequence: 3 })
  })
  test('same revision restarts keep one loop and source rotation fences the old loop', async () => {
    let calls = 0
    const runtime = {
      collect: async (source: PublicInformationSource) => {
        calls += 1
        return run(source)
      },
    }
    const original = harness(runtime)
    await original.handlers.activate(original.ctx, { source: original.ctx.key, sourceRevision: revision })
    const restarted = harness(runtime, PublicInformationSource.Filings, revision, original.durable)
    await restarted.handlers.activate(restarted.ctx, { source: restarted.ctx.key, sourceRevision: revision })
    expect(restarted.sends).toEqual([])
    const rotated = harness(runtime, PublicInformationSource.Filings, 'c'.repeat(40), original.durable)
    await rotated.handlers.activate(rotated.ctx, { source: rotated.ctx.key, sourceRevision: 'c'.repeat(40) })
    await original.handlers.poll(original.ctx, original.sends[0]?.parameter)
    expect(calls).toBe(0)
    expect(rotated.durable.get('state')).toMatchObject({ epoch: 2, sequence: 1 })
  })
  test('activation requires a signature scoped to this purpose, source and deployed revision', async () => {
    const h = harness({ collect: async (source) => run(source) })
    for (const approval of [
      '0'.repeat(64),
      approvePublicInformation(PublicInformationSource.Macro, revision, key),
      approvePublicInformation(PublicInformationSource.Filings, 'c'.repeat(40), key),
    ]) {
      const result = await h.control
        .activate(h.ctx, { source: h.ctx.key, sourceRevision: revision, approval })
        .catch((error: unknown) => error)
      expect(result).toBeInstanceOf(Error)
    }
    expect(h.calls).toHaveLength(0)
    await h.control.activate(h.ctx, {
      source: h.ctx.key,
      sourceRevision: revision,
      approval: approvePublicInformation(PublicInformationSource.Filings, revision, key),
    })
    expect(h.calls.map(({ service, method, key, parameter }) => ({ service, method, key, parameter }))).toEqual([
      {
        service: 'BaynPublicInformation',
        method: 'activate',
        key: PublicInformationSource.Filings,
        parameter: { source: PublicInformationSource.Filings, sourceRevision: revision },
      },
    ])
  })
})

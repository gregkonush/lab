import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'
import { NodeServices } from '@effect/platform-node'
import { Exit, ManagedRuntime } from 'effect'

import { sha256 } from '../src/hash'
import { equityEdgeScreenProgram } from './equity-edge-screen'

test('offline command validates pins, preserves zero-activity sessions and never overwrites retained evidence', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bayn-equity-edge-fixture-'))
  const runtime = ManagedRuntime.make(NodeServices.layer)
  try {
    const observedAt = '2026-10-17T06:24:39.700Z'
    const calendar = Array.from({ length: 17 }, (_, i) => ({
      date: `2026-08-${String(i + 3).padStart(2, '0')}`,
      open: '09:30',
      close: '16:00',
      session_open: '0400',
      session_close: '2000',
    }))
    const source =
      [
        { kind: 'calendar', observedAt, data: calendar },
        { kind: 'bars', page: 0, requestPageToken: null, observedAt, data: { bars: {}, next_page_token: null } },
        { kind: 'complete', pages: 1, bars: 0, observedAt, feed: 'iex', adjustment: 'raw' },
      ]
        .map((row) => JSON.stringify(row))
        .join('\n') + '\n'
    const input = JSON.stringify({
      schemaVersion: 'bayn.equity-edge-screen-input.v1',
      sourceSha256: sha256(source),
      symbols: ['SPY', 'AAPL'],
      development: { start: '2026-08-17', end: '2026-08-17' },
      validation: { start: '2026-08-18', end: '2026-08-18' },
      holdout: { start: '2026-08-19', end: '2026-08-19' },
    })
    const inputPath = join(directory, 'input.json'),
      sourcePath = join(directory, 'source.ndjson'),
      outputPath = join(directory, 'report.json')
    writeFileSync(inputPath, input)
    writeFileSync(sourcePath, source)
    const args = ['--input', inputPath, '--input-sha256', sha256(input), '--source', sourcePath, '--output', outputPath]
    const receipt = await runtime.runPromise(equityEdgeScreenProgram(args))
    expect(receipt.decision).toBe('REJECT_FOR_PROMOTION')
    expect(receipt.qualified).toBe(false)
    expect(receipt.selection.policy).toBeNull()
    expect(receipt.selection.trialCount).toBe(13)
    const before = readFileSync(outputPath, 'utf8')
    expect(before).toContain('"allInProfit":null')
    expect(before).toContain('"missing":390')
    const rerun = await runtime.runPromiseExit(equityEdgeScreenProgram(args))
    expect(Exit.isFailure(rerun)).toBe(true)
    expect(readFileSync(outputPath, 'utf8')).toBe(before)
    writeFileSync(inputPath, input + '\n')
    const changed = await runtime.runPromiseExit(
      equityEdgeScreenProgram([...args.slice(0, 7), join(directory, 'changed.json')]),
    )
    expect(Exit.isFailure(changed)).toBe(true)
  } finally {
    await runtime.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})

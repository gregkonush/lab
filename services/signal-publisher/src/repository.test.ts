import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { insertBatchSize, partitionInsertRows } from './repository'

describe('ClickHouse readback contract', () => {
  test('preserves the Decimal64 scale used by snapshot content hashes', () => {
    const source = readFileSync(import.meta.dir + '/repository.ts', 'utf8')

    for (const column of ['adjusted_open', 'adjusted_high', 'adjusted_low', 'adjusted_close', 'adjusted_volume']) {
      expect(source).toContain(`toDecimalString(${column}, 8) AS ${column}`)
    }
    expect(source).toContain('toDecimalString(vwap, 8)')
    expect(source).not.toMatch(/toString\(adjusted_(?:open|high|low|close|volume)\)/)
  })

  test('bounds quorum inserts without dropping or reordering rows', () => {
    const rows = Array.from({ length: insertBatchSize * 2 + 17 }, (_, index) => ({ session_date: '2026-10-12', index }))
    const batches = partitionInsertRows(rows)

    expect(batches.map((batch) => batch.length)).toEqual([insertBatchSize, insertBatchSize, 17])
    expect(batches.flat()).toEqual(rows)
    expect(partitionInsertRows([])).toEqual([])
  })
  test('one quorum insert touches one yearly partition even when source rows are symbol ordered', () => {
    const rows = [
      { symbol: 'AAPL', session_date: '2025-12-31' },
      { symbol: 'AAPL', session_date: '2026-01-02' },
      { symbol: 'MSFT', session_date: '2025-12-31' },
      { symbol: 'MSFT', session_date: '2026-01-02' },
    ]
    const batches = partitionInsertRows(rows)
    expect(batches).toEqual([
      [rows[0], rows[2]],
      [rows[1], rows[3]],
    ])
    expect(batches.map((batch) => new Set(batch.map((row) => row.session_date.slice(0, 4))).size)).toEqual([1, 1])
    expect(batches.flat().sort((a, b) => rows.indexOf(a) - rows.indexOf(b))).toEqual(rows)
    expect(partitionInsertRows([...rows].reverse()).map((batch) => batch[0]?.session_date.slice(0, 4))).toEqual([
      '2025',
      '2026',
    ])
  })
})

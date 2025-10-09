import { describe, expect, it } from 'vitest'
import { buildChannelName, chunkContent, consumeChunks, DISCORD_MESSAGE_LIMIT } from './discord'

describe('buildChannelName', () => {
  it('creates a stable channel name using repo slug, issue, stage, timestamp, and run id', () => {
    const channel = buildChannelName({
      repository: 'gregkonush/lab',
      issueNumber: 1243,
      stage: 'planning',
      runId: 'relay-xyz123',
      createdAt: new Date('2025-10-07T12:34:56Z'),
    })

    expect(channel).toBe('lab-issue-1243-planning-20251007t1234-relay-xyz123')
  })

  it('trims long channel names without breaking semantics', () => {
    const channel = buildChannelName({
      repository: 'example/this-is-a-very-long-repository-name-with-many-segments',
      issueNumber: 42,
      stage: 'implementation',
      runId: 'abcdefghijklmno',
      createdAt: new Date('2025-10-07T12:34:56Z'),
    })

    expect(channel.length).toBeLessThanOrEqual(95)
    expect(channel).toMatch(/^this-is-a-very-long-repository-name-with-many-segments-issue-42-implementation-/)
  })
})

describe('chunkContent', () => {
  it('splits content into Discord-safe chunks prioritising newline boundaries', () => {
    const sample = Array.from({ length: 120 }, (_, index) => `line-${index.toString().padStart(3, '0')}`).join('\n')
    const { chunks, remainder } = consumeChunks(sample, 100)

    expect(chunks.length).toBeGreaterThan(0)
    const firstChunk = chunks.at(0)
    const secondChunk = chunks.at(1)
    if (!firstChunk || !secondChunk) {
      throw new Error('Expected at least two chunks to validate newline boundaries')
    }
    expect(firstChunk.endsWith('line-010')).toBeTruthy()
    expect(secondChunk.startsWith('line-011')).toBeTruthy()
    expect(chunks.every((chunk) => chunk.length <= 100)).toBeTruthy()
    expect(chunks.at(-1)?.length ?? 0).toBeLessThanOrEqual(100)
    expect(remainder.startsWith('line-110')).toBeTruthy()
    expect(remainder.length).toBeLessThanOrEqual(100)
  })

  it('returns the original content when within the Discord limit', () => {
    const content = 'ok'.repeat(100)
    const chunks = chunkContent(content, DISCORD_MESSAGE_LIMIT)
    expect(chunks).toEqual([content])
  })
})

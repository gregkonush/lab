import { describe, expect, it } from 'vitest'

import { parseCompletion } from './completion'
import fixture from '../../fixtures/argo-completion.json' with { type: 'json' }

describe('completion schema', () => {
  it('parses the workflow completion fixture', () => {
    const completion = parseCompletion(fixture)

    expect(completion.metadata.name).toBe('notify-artifacts-20251005-1700')
    expect(completion.metadata.annotations?.['courriel/email-to']).toContain('data-team@example.com')
    expect(completion.status.phase).toBe('Succeeded')
  })

  it('throws on invalid payloads', () => {
    expect(() => parseCompletion({})).toThrowError()
  })
})

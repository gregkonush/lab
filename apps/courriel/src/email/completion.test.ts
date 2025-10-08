import { describe, expect, it } from 'vitest'

import type { AppConfig } from '../config'
import { buildCompletionEmail } from './completion'
import fixture from '../../fixtures/argo-completion.json' with { type: 'json' }

const baseConfig: AppConfig = {
  kafka: {
    brokers: ['broker:9092'],
    clientId: 'courriel',
    groupId: 'courriel-group',
    topic: 'argo.workflows.completions',
    sasl: {
      mechanism: 'scram-sha-512',
      username: 'user',
      password: 'pass',
    },
    ssl: true,
  },
  resend: {
    apiKey: 're_test',
    from: 'Courriel <courriel@example.com>',
    fallbackRecipients: ['fallback@example.com'],
  },
  email: {
    subjectPrefix: '[Argo]',
  },
  logging: {
    level: 'info',
  },
}

describe('buildCompletionEmail', () => {
  it('uses annotations to populate recipients and metadata', () => {
    const email = buildCompletionEmail(fixture, baseConfig)

    expect(email.from).toBe('Argo Bot <argo-bot@example.com>')
    expect(email.to).toContain('data-team@example.com')
    expect(email.subject).toContain('Dataset refresh completed')
    expect(email.replyTo).toBe('ml-oncall@example.com')
    expect(email.headers['X-Courriel-Workflow-UID']).toBe(fixture.metadata.uid)
    expect(email.html).toContain('notify-artifacts-20251005-1700')
  })

  it('falls back to configured recipients when no annotations resolve', () => {
    const payload = JSON.parse(JSON.stringify(fixture))
    delete payload.metadata.annotations?.['courriel/email-to']
    payload.metadata.annotations = {}
    payload.spec.arguments = { parameters: [] }

    const email = buildCompletionEmail(payload, baseConfig)

    expect(email.to).toEqual(['fallback@example.com'])
    expect(email.from).toBe(baseConfig.resend.from)
    expect(email.subject).toContain('Workflow notify-artifacts-20251005-1700')
  })
})

import { describe, expect, it, vi } from 'vitest'

import {
  buildDeferredResponsePayload,
  INTERACTION_TYPE,
  toCommandEvent,
  verifyDiscordRequest,
  type DiscordInteraction,
} from '@/discord-commands'

const { verifyKeyMock } = vi.hoisted(() => ({
  verifyKeyMock: vi.fn(() => true),
}))

vi.mock('discord-interactions', () => ({
  verifyKey: verifyKeyMock,
}))

describe('verifyDiscordRequest', () => {
  it('returns false when signature headers are missing', async () => {
    const headers = new Headers()
    expect(await verifyDiscordRequest(new TextEncoder().encode('{}'), headers, 'public')).toBe(false)
    expect(verifyKeyMock).not.toHaveBeenCalled()
  })

  it('delegates to verifyKey when headers present', async () => {
    const headers = new Headers({
      'x-signature-ed25519': 'sig',
      'x-signature-timestamp': 'ts',
    })

    const body = new TextEncoder().encode('{}')
    expect(await verifyDiscordRequest(body, headers, 'public')).toBe(true)
    expect(verifyKeyMock).toHaveBeenCalledWith(body, 'sig', 'ts', 'public')
  })
})

describe('toCommandEvent', () => {
  const baseInteraction: DiscordInteraction = {
    type: INTERACTION_TYPE.APPLICATION_COMMAND,
    id: '1',
    token: 'token',
    version: 1,
    application_id: 'app',
    data: {
      id: 'command',
      name: 'plan',
      type: 1,
      options: [
        { name: 'project', type: 3, value: 'codex' },
        {
          name: 'details',
          type: 1,
          options: [
            { name: 'objective', type: 3, value: 'Ship it' },
            { name: 'priority', type: 4, value: 1 },
          ],
        },
      ],
    },
    member: {
      user: {
        id: 'user',
        username: 'tester',
        global_name: 'Tester',
        discriminator: '1234',
      },
      roles: ['role-1'],
    },
  }

  it('normalises command options and user metadata', () => {
    const event = toCommandEvent(baseInteraction, { deferType: 'channel-message', ephemeral: true })

    expect(event.command).toBe('plan')
    expect(event.options).toEqual({
      project: 'codex',
      'details.objective': 'Ship it',
      'details.priority': '1',
    })
    expect(event.user).toEqual({
      id: 'user',
      username: 'tester',
      globalName: 'Tester',
      discriminator: '1234',
    })
    expect(event.member?.roles).toEqual(['role-1'])
    expect(event.response).toEqual({ type: 4, flags: 64 })
  })

  it('throws when interaction type unsupported', () => {
    expect(() =>
      toCommandEvent(
        { ...baseInteraction, type: INTERACTION_TYPE.MESSAGE_COMPONENT },
        { deferType: 'channel-message', ephemeral: false },
      ),
    ).toThrow(/Unsupported interaction type/)
  })
})

describe('buildDeferredResponsePayload', () => {
  it('returns deferred response with flags when ephemeral', () => {
    expect(buildDeferredResponsePayload({ deferType: 'channel-message', ephemeral: true })).toEqual({
      type: 5,
      data: { flags: 64 },
    })
    expect(buildDeferredResponsePayload({ deferType: 'channel-message', ephemeral: false })).toEqual({
      type: 5,
      data: undefined,
    })
  })
})

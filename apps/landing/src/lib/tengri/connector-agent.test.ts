import { expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'
import type { TengriIdentity } from './auth'
import { Action, ResourceKind } from './generated/proompteng/authz/v1/authz_pb'

void mock.module('server-only', () => ({}))
const { installConnectorAgent, reconcileConnectorCleanups } = await import('./connector-agent')
type Dependencies = NonNullable<Parameters<typeof installConnectorAgent>[5]>
const connection = '11111111-1111-4111-8111-111111111111'
const workspace = '22222222-2222-4222-8222-222222222222'
const agentId = '33333333-3333-4333-8333-333333333333'
const oldGrant = '44444444-4444-4444-8444-444444444444'
const identity = { session: { id: 'session', humanId: 'a'.repeat(64) } } as TengriIdentity
type CleanupDependencies = NonNullable<Parameters<typeof reconcileConnectorCleanups>[3]>
type Agents = Parameters<typeof reconcileConnectorCleanups>[1]

test('sleeping cleanup survives a BFF restart and is acknowledged only after guest removal', async () => {
  const jobs = [{ connectionId: connection, workspaceUid: workspace }]
  const events: string[] = []
  let fail = false
  const dependencies = (): CleanupDependencies =>
    ({
      relayCall: async (input: { action: string; id?: string; workspace?: string }) => {
        if (input.action === 'list') return { cleanups: [...jobs] }
        expect(input).toEqual({ action: 'ackCleanup', id: connection, workspace })
        events.push('ack')
        jobs.splice(0)
        return { acknowledged: true }
      },
      connectorAgent: async () => {
        events.push('remove')
        if (fail) throw new Error('Guest unavailable')
        return { configured: false }
      },
    }) as unknown as CleanupDependencies
  const agents = (phase: string) => [{ id: 'guest', uid: workspace, phase }] as Agents
  expect(await reconcileConnectorCleanups(identity, agents('sleeping'), undefined, dependencies())).toEqual({
    agentCleanupPending: true,
  })
  expect(events).toEqual([])
  fail = true
  expect(await reconcileConnectorCleanups(identity, agents('ready'), undefined, dependencies())).toEqual({
    agentCleanupPending: true,
  })
  expect(jobs).toHaveLength(1)
  expect(events).toEqual(['remove'])
  fail = false
  expect(await reconcileConnectorCleanups(identity, agents('ready'), undefined, dependencies())).toEqual({
    agentCleanupPending: false,
  })
  expect(jobs).toHaveLength(0)
  expect(events).toEqual(['remove', 'remove', 'ack'])
})

test('unconfirmed grant revocation retries after Ofz recovers without a running guest', async () => {
  let available = false
  let queued = true
  let revoked = false
  const dependencies = {
    relayCall: async (command: { action: string; status?: string }) => {
      if (command.action === 'list')
        return { cleanups: [], grantCleanups: queued ? [{ grantId: oldGrant, workspaceUid: workspace }] : [] }
      expect(command.status).toBe('revoked')
      expect(revoked).toBe(true)
      queued = false
      return { updated: true }
    },
    connectorAgent: async () => {
      throw new Error('No guest operation is needed for grant revocation')
    },
    ofzCall: async (method: { name: string }, request: { command?: { case: string; value: { grantId: string } } }) => {
      if (!available) throw new Error('Ofz unavailable')
      if (method.name === 'GetPolicyState') return { version: 1n }
      expect(request.command).toEqual({ case: 'revokeGrant', value: { grantId: oldGrant } })
      revoked = true
      return { receipt: {} }
    },
  } as unknown as CleanupDependencies
  expect(await reconcileConnectorCleanups(identity, [], undefined, dependencies)).toEqual({ agentCleanupPending: true })
  expect(queued).toBe(true)
  available = true
  expect(await reconcileConnectorCleanups(identity, [], undefined, { ...dependencies })).toEqual({
    agentCleanupPending: false,
  })
  expect(queued).toBe(false)
})

function fixture(failInstall = false, abort?: AbortController, unavailable = false) {
  const commands: { case: string; value: Record<string, unknown> }[] = []
  const guest: { action: string; value: Record<string, unknown> }[] = []
  const cursors: string[] = []
  const statuses: string[] = []
  const deps = {
    listAgents: async () => [{ uid: workspace, id: 'guest', phase: 'ready' }],
    connectorAgent: async (_identity: unknown, _agent: string, action: string, value: Record<string, unknown>) => {
      guest.push({ action, value })
      if (action === 'identity') return { agentId, proofKeyThumbprint: 'b'.repeat(43) }
      if (failInstall && action === 'configure') {
        abort?.abort()
        throw new Error('Guest acknowledgement lost')
      }
      return { configured: action === 'configure' }
    },
    relayCall: async (command: { action: string; status?: string }, _identity: unknown, signal?: AbortSignal) => {
      if (signal?.aborted) throw new Error('Request signal is aborted')
      if (command.action === 'setGrantStatus') statuses.push(command.status!)
      return command.action === 'list'
        ? { connections: [{ id: connection, providerId: 'api' }] }
        : {
            providers: [
              {
                id: 'api',
                operations: [
                  { name: 'read', description: 'Read', inputSchema: { type: 'object' }, readOnly: true },
                  { name: 'write', description: 'Write', inputSchema: { type: 'object' }, readOnly: false },
                ],
              },
            ],
          }
    },
    ofzCall: async (
      method: { name: string },
      request: { cursor?: string; command?: { case: string; value: Record<string, unknown> } },
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) throw new Error('Request signal is aborted')
      if (unavailable && request.command?.case === 'revokeGrant') throw new Error('Ofz unavailable')
      if (method.name === 'ListAccess') {
        cursors.push(request.cursor || '')
        return request.cursor
          ? {
              entries: [
                {
                  grantId: oldGrant,
                  subjectId: agentId,
                  resource: { kind: ResourceKind.CONNECTOR_CONNECTION, id: connection },
                },
              ],
              cursor: '',
            }
          : { entries: [], cursor: 'next' }
      }
      if (method.name === 'GetPolicyState') return { version: 1n }
      if (request.command) commands.push(request.command)
      return { receipt: { agentCredential: 'c'.repeat(43) } }
    },
  } as unknown as Dependencies
  return { deps, commands, guest, cursors, statuses }
}

test('clearing every operation removes guest configuration and revokes grants across pages', async () => {
  const f = fixture()
  expect(await installConnectorAgent(identity, connection, workspace, [], undefined, f.deps)).toEqual({
    expiresAt: null,
  })
  expect(f.cursors).toEqual(['', 'next'])
  expect(f.guest.at(-1)?.action).toBe('remove')
  expect(f.commands).toEqual([{ case: 'revokeGrant', value: { grantId: oldGrant } }])
})

test('installation delegates exact reviewed read and write operations without provider secrets', async () => {
  const f = fixture()
  const result = await installConnectorAgent(identity, connection, workspace, ['read', 'write'], undefined, f.deps)
  expect(Date.parse(result.expiresAt!) - Date.now()).toBeLessThanOrEqual(3_600_000)
  expect(f.commands[0]?.value.actions).toEqual([Action.CONNECTOR_READ, Action.CONNECTOR_INVOKE])
  expect(f.commands[0]?.value.scope).toEqual({
    connectorOperations: ['read', 'write'],
    maxBytes: 1_048_576,
    maxItems: 200,
  })
  const configured = f.guest.find((entry) => entry.action === 'configure')!.value
  expect(configured.credential).toBe('c'.repeat(43))
  expect(configured.operations).toMatchObject([
    { name: 'read', readOnly: true },
    { name: 'write', readOnly: false },
  ])
  expect(configured).not.toHaveProperty('accessToken')
  expect(f.commands.at(-1)?.value.grantId).toBe(oldGrant)
})

test('failed installation revokes its new capability and leaves the previous grant intact', async () => {
  const f = fixture(true)
  await assert.rejects(
    installConnectorAgent(identity, connection, workspace, ['read'], undefined, f.deps),
    /acknowledgement lost/,
  )
  expect(f.commands).toHaveLength(2)
  expect(f.commands[1]?.case).toBe('revokeGrant')
  expect(f.commands[1]?.value.grantId).toBe(f.commands[0]?.value.grantId)
  expect(f.commands[1]?.value.grantId).not.toBe(oldGrant)
})

test('browser abort does not cancel compensating revocation; unavailable Ofz leaves durable cancellation', async () => {
  for (const unavailable of [false, true]) {
    const abort = new AbortController()
    const f = fixture(true, abort, unavailable)
    await assert.rejects(
      installConnectorAgent(identity, connection, workspace, ['read'], abort.signal, f.deps),
      /acknowledgement lost/,
    )
    expect(abort.signal.aborted).toBe(true)
    expect(f.statuses).toEqual(unavailable ? ['cancelled'] : ['cancelled', 'revoked'])
    if (!unavailable) expect(f.commands.at(-1)?.case).toBe('revokeGrant')
  }
})

import 'server-only'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { TengriIdentity } from './auth'
import { humanContext } from './authorization'
import { connectorAgent, listAgents } from './grpc'
import { Action, AuthorizationService, ResourceKind } from './generated/proompteng/authz/v1/authz_pb'
import { OfzError, ofzCall } from './ofz'
import { relayCall } from './relay'
import type { TengriAgent } from './types'

const operationSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.json(),
  readOnly: z.boolean(),
})

export async function installConnectorAgent(
  identity: TengriIdentity,
  connectionId: string,
  workspaceUid: string,
  operations: string[],
  signal?: AbortSignal,
  dependencies = { listAgents, connectorAgent, ofzCall, relayCall },
) {
  const { listAgents, connectorAgent, ofzCall, relayCall } = dependencies
  const agent = (await listAgents(identity)).find((agent) => agent.uid === workspaceUid)
  if (!agent || agent.phase !== 'ready') throw new OfzError(403)
  const identityResult = z
    .object({ agentId: z.uuid(), proofKeyThumbprint: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .parse(await connectorAgent(identity, agent.id, 'identity', {}, signal))
  const accounts = z
    .object({ connections: z.array(z.object({ id: z.uuid(), providerId: z.string() })) })
    .parse(await relayCall({ action: 'list' }, identity, signal))
  const connection = accounts.connections.find((connection) => connection.id === connectionId)
  if (!connection) throw new OfzError(404)
  const catalog = z
    .object({ providers: z.array(z.object({ id: z.string(), operations: z.array(operationSchema) })) })
    .parse(await relayCall({ action: 'providers' }, identity, signal))
  const provider = catalog.providers.find((provider) => provider.id === connection.providerId)
  const selected = provider?.operations.filter((operation) => operations.includes(operation.name))
  if (!selected || selected.length !== operations.length) throw new OfzError(400)
  const context = humanContext(identity, workspaceUid)
  const previous = []
  let cursor = ''
  do {
    const page = await ofzCall(
      AuthorizationService.method.listAccess,
      {
        context: humanContext(identity, workspaceUid),
        resource: { kind: ResourceKind.WORKSPACE, id: workspaceUid },
        limit: 100,
        cursor,
      },
      signal,
    )
    previous.push(...page.entries)
    cursor = page.cursor
    if (previous.length > 10_000) throw new OfzError(503)
  } while (cursor)
  const revoke = async (id: string, revokeSignal = signal) => {
    const current = await ofzCall(AuthorizationService.method.getPolicyState, {}, revokeSignal)
    await ofzCall(
      AuthorizationService.method.executeCommand,
      {
        context: humanContext(identity, workspaceUid),
        operationId: randomUUID(),
        expectedVersion: current.version,
        reason: 'Remove the previous connector capability',
        command: { case: 'revokeGrant', value: { grantId: id } },
      },
      revokeSignal,
    )
  }
  const matching = previous.filter(
    (entry) =>
      entry.grantId &&
      entry.subjectId === identityResult.agentId &&
      entry.resource?.id === connectionId &&
      entry.resource.kind === ResourceKind.CONNECTOR_CONNECTION,
  )
  if (!operations.length) {
    await connectorAgent(identity, agent.id, 'remove', { connectionId }, signal)
    for (const entry of matching) await revoke(entry.grantId)
    return { expiresAt: null }
  }
  const state = await ofzCall(AuthorizationService.method.getPolicyState, {}, signal)
  const grantId = randomUUID()
  const expiresAt = Date.now() + 3_599_000
  const actions = [
    ...(selected.some((operation) => operation.readOnly) ? [Action.CONNECTOR_READ] : []),
    ...(selected.some((operation) => !operation.readOnly) ? [Action.CONNECTOR_INVOKE] : []),
  ]
  await relayCall(
    {
      action: 'stageGrant',
      id: connectionId,
      workspace: workspaceUid,
      grantId,
      expiresAt: new Date(expiresAt).toISOString(),
    },
    identity,
    signal,
  )
  try {
    const result = await ofzCall(
      AuthorizationService.method.executeCommand,
      {
        context,
        operationId: randomUUID(),
        expectedVersion: state.version,
        reason: 'Enable selected connector operations for this agent',
        command: {
          case: 'createGrant',
          value: {
            grantId,
            agentId: identityResult.agentId,
            workspaceUid,
            resource: { kind: ResourceKind.CONNECTOR_CONNECTION, id: connectionId },
            actions,
            scope: { connectorOperations: operations, maxBytes: 1_048_576, maxItems: 200 },
            expiresAtUnixMs: BigInt(expiresAt),
            proofKeyThumbprint: identityResult.proofKeyThumbprint,
          },
        },
      },
      signal,
    )
    const credential = result.receipt?.agentCredential
    if (!credential) throw new OfzError(503)
    const endpoint = new URL(
      '/api/tengri/connectors/agent',
      process.env.TENGRI_DESKTOP_ORIGIN || 'https://proompteng.ai',
    ).toString()
    await connectorAgent(
      identity,
      agent.id,
      'configure',
      {
        connectionId,
        endpoint,
        grantId,
        credential,
        operations: selected.map(({ name, description, inputSchema, readOnly }) => ({
          name,
          description,
          inputSchema,
          readOnly,
        })),
      },
      signal,
    )
    await relayCall({ action: 'setGrantStatus', grantId, status: 'active' }, identity, signal)
  } catch (error) {
    // The staged grant is denied until the guest acknowledgement and activation both succeed.
    // Compensation must survive a browser cancellation; the durable record also survives BFF loss.
    const cleanupSignal = AbortSignal.timeout(8000)
    try {
      await relayCall({ action: 'setGrantStatus', grantId, status: 'cancelled' }, identity, cleanupSignal)
    } catch {
      process.stderr.write('Relay grant cancellation remains queued\n')
    }
    try {
      await revoke(grantId, cleanupSignal)
      await relayCall({ action: 'setGrantStatus', grantId, status: 'revoked' }, identity, cleanupSignal)
    } catch {
      process.stderr.write('Relay grant revocation remains queued\n')
    }
    throw error
  }
  // Replace previous capabilities only after the new configuration is installed. Scope narrowing
  // already takes effect in Relay before installation, including while this request is retried.
  for (const entry of matching) await revoke(entry.grantId)
  return { expiresAt: new Date(expiresAt).toISOString() }
}

export async function reconcileConnectorCleanups(
  identity: TengriIdentity,
  agents: TengriAgent[],
  signal?: AbortSignal,
  dependencies = { relayCall, connectorAgent, ofzCall },
) {
  const { relayCall, connectorAgent, ofzCall } = dependencies
  const listing = z
    .object({
      cleanups: z.array(z.object({ connectionId: z.uuid(), workspaceUid: z.uuid() })),
      grantCleanups: z.array(z.object({ grantId: z.uuid(), workspaceUid: z.uuid() })).default([]),
    })
    .parse(await relayCall({ action: 'list' }, identity, signal))
  let grantPending = false
  for (const job of listing.grantCleanups.slice(0, 16)) {
    try {
      const state = await ofzCall(AuthorizationService.method.getPolicyState, {}, signal)
      await ofzCall(
        AuthorizationService.method.executeCommand,
        {
          context: humanContext(identity, job.workspaceUid),
          operationId: randomUUID(),
          expectedVersion: state.version,
          reason: 'Revoke an unconfirmed connector installation',
          command: { case: 'revokeGrant', value: { grantId: job.grantId } },
        },
        signal,
      )
      await relayCall({ action: 'setGrantStatus', grantId: job.grantId, status: 'revoked' }, identity, signal)
    } catch {
      grantPending = true
      process.stderr.write('Relay grant revocation remains queued\n')
    }
  }
  let remaining = listing.cleanups.length
  for (const job of listing.cleanups.slice(0, 16)) {
    const agent = agents.find((agent) => agent.uid === job.workspaceUid && agent.phase === 'ready')
    if (!agent) continue
    try {
      await connectorAgent(identity, agent.id, 'remove', { connectionId: job.connectionId }, signal)
      await relayCall({ action: 'ackCleanup', id: job.connectionId, workspace: job.workspaceUid }, identity, signal)
      remaining -= 1
    } catch {
      // The database entry is retained until both guest removal and acknowledgement succeed.
      process.stderr.write('Relay connector cleanup remains pending\n')
    }
  }
  return { agentCleanupPending: remaining > 0 || grantPending || listing.grantCleanups.length > 16 }
}

export async function removeConnectorAgents(identity: TengriIdentity, signal?: AbortSignal) {
  return reconcileConnectorCleanups(identity, await listAgents(identity), signal)
}

import 'server-only'

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { TengriIdentity } from './auth'
import { humanContext } from './authorization'
import { connectorAgent, listAgents } from './grpc'
import { Action, AuthorizationService, ResourceKind } from './generated/proompteng/authz/v1/authz_pb'
import { OfzError, ofzCall } from './ofz'
import { relayCall } from './relay'

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
  const revoke = async (id: string) => {
    const current = await ofzCall(AuthorizationService.method.getPolicyState, {}, signal)
    await ofzCall(
      AuthorizationService.method.executeCommand,
      {
        context: humanContext(identity, workspaceUid),
        operationId: randomUUID(),
        expectedVersion: current.version,
        reason: 'Remove the previous connector capability',
        command: { case: 'revokeGrant', value: { grantId: id } },
      },
      signal,
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
  try {
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
  } catch (error) {
    // An acknowledgement may be lost after installation, so revoke on every failure.
    await revoke(grantId)
    throw error
  }
  // Replace previous capabilities only after the new configuration is installed. Scope narrowing
  // already takes effect in Relay before installation, including while this request is retried.
  for (const entry of matching) await revoke(entry.grantId)
  return { expiresAt: new Date(expiresAt).toISOString() }
}

export async function removeConnectorAgents(
  identity: TengriIdentity,
  connectionId: string,
  workspaces: string[],
  signal?: AbortSignal,
) {
  const agents = await listAgents(identity)
  let pending = false
  for (const agent of agents) {
    if (!workspaces.includes(agent.uid)) continue
    if (agent.phase !== 'ready') {
      pending = true
      continue
    }
    try {
      await connectorAgent(identity, agent.id, 'remove', { connectionId }, signal)
    } catch {
      pending = true
    }
  }
  return { agentCleanupPending: pending }
}

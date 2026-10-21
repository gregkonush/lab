import { connectorCommandSchema } from '@/lib/tengri/connector-schemas'
import { configureConnector, relayCall } from '@/lib/tengri/relay'
import { installConnectorAgent, removeConnectorAgents } from '@/lib/tengri/connector-agent'
import {
  noStoreHeaders,
  readTengriJsonBody,
  requireSameOrigin,
  requireTengriIdentity,
  tengriRouteError,
} from '@/lib/tengri/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    requireSameOrigin(request)
    const identity = await requireTengriIdentity(request)
    const command = connectorCommandSchema.parse(
      await readTengriJsonBody(request, { subject: identity.subject, maxBytes: 1_048_576 }),
    )
    if (command.action === 'create') {
      await configureConnector(identity, command.id, command.operationId, true, true, request.signal)
    }
    if (command.action === 'disconnect') {
      await configureConnector(identity, command.id, command.operationId, false, false, request.signal)
    }
    const { operationId: _operationId, ...relayCommand } = command as typeof command & { operationId?: string }
    const result = await relayCall(relayCommand, identity, request.signal)
    if (command.action === 'bind')
      Object.assign(
        result,
        await installConnectorAgent(identity, command.id, command.workspace, command.operations, request.signal),
      )
    if (command.action === 'disconnect') Object.assign(result, await removeConnectorAgents(identity, request.signal))
    return Response.json(result, { headers: noStoreHeaders() })
  } catch (error) {
    if (error instanceof Error && error.name === 'ZodError')
      return Response.json(
        { error: 'Check the connection fields and try again.' },
        { status: 400, headers: noStoreHeaders() },
      )
    return tengriRouteError(error)
  }
}

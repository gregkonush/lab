import 'server-only'

import { createHash } from 'node:crypto'
import { Agent, request as httpsRequest } from 'node:https'
import path from 'node:path'
import { toBinary } from '@bufbuild/protobuf'
import type { TengriIdentity } from './auth'
import { humanContext } from './authorization'
import { listAgents } from './grpc'
import { AuthorizationService, RequestContextSchema } from './generated/proompteng/authz/v1/authz_pb'
import { OfzError, ofzCall } from './ofz'
import { SpiffeSource, verifySpiffePeer } from './spiffe'

const BFF_ID = 'spiffe://proompteng.ai/ns/proompteng/sa/proompteng'
const RELAY_ID = 'spiffe://proompteng.ai/ns/tengri/sa/tengri-connector-broker'
let source: SpiffeSource | undefined
let socket: string | undefined
let agent: Agent | undefined
let fingerprint: string | undefined

export async function relayCall(
  command: Record<string, unknown>,
  identity?: TengriIdentity,
  signal?: AbortSignal,
  transport: typeof httpsRequest = httpsRequest,
) {
  const endpoint = process.env.RELAY_ENDPOINT?.trim()
  const workloadSocket = process.env.SPIFFE_ENDPOINT_SOCKET?.trim()
  if (!endpoint || !workloadSocket || process.env.SPIFFE_ID !== BFF_ID) throw new OfzError(503)
  const url = new URL(endpoint)
  if (
    url.protocol !== 'https:' ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    !url.hostname.endsWith('.svc.cluster.local')
  )
    throw new OfzError(503)
  if (!source || socket !== workloadSocket) {
    source?.close()
    source = new SpiffeSource({
      endpoint: workloadSocket,
      spiffeId: BFF_ID,
      protoPath:
        process.env.SPIFFE_WORKLOAD_API_PROTO_PATH?.trim() ??
        path.resolve(process.cwd(), '../../services/tengri/proto/spiffe/workloadapi.proto'),
    })
    socket = workloadSocket
  }
  const material = await source.material()
  if (!agent || fingerprint !== material.fingerprint) {
    const previous = agent
    agent = new Agent({
      keepAlive: true,
      maxSockets: 16,
      ca: material.bundle,
      cert: material.certificate,
      key: material.privateKey,
      checkServerIdentity: (_hostname, certificate) => verifySpiffePeer(RELAY_ID, certificate),
    })
    fingerprint = material.fingerprint
    const current = agent
    setTimeout(() => current.destroy(), Math.max(0, material.expiresAt - Date.now())).unref()
    if (previous) setTimeout(() => previous.destroy(), 40_000).unref()
  }
  const workspace = typeof command.workspace === 'string' ? command.workspace : ''
  let epoch = ''
  if (identity && command.action === 'invoke') {
    const target = (await listAgents(identity)).find((agent) => agent.uid === workspace)
    if (!target?.runtimeEpoch || target.phase !== 'ready') throw new OfzError(403)
    epoch = target.runtimeEpoch
  }
  const context = identity
    ? Buffer.from(toBinary(RequestContextSchema, humanContext(identity, workspace, epoch))).toString('base64')
    : undefined
  const body = Buffer.from(JSON.stringify({ context, command }))
  if (body.length > 2_097_152) throw new OfzError(400)
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const request = transport(
      new URL('/v1/request', url),
      {
        method: 'POST',
        agent,
        signal,
        timeout: 40_000,
        headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
      },
      (response) => {
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > 2_097_152 + 65536) {
            response.destroy()
            reject(new OfzError(503))
            return
          }
          chunks.push(chunk)
        })
        response.on('error', () => reject(new OfzError(503)))
        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(
              new OfzError(
                [400, 401, 403, 409, 428, 429].includes(response.statusCode || 0) ? response.statusCode! : 503,
              ),
            )
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
          } catch {
            reject(new OfzError(503))
          }
        })
      },
    )
    request.on('timeout', () => request.destroy(new Error('Relay timed out')))
    request.on('error', (cause) => reject(new OfzError(503, '', cause)))
    request.end(body)
  })
}

export function closeRelayClient() {
  agent?.destroy()
  source?.close()
  agent = undefined
  source = undefined
  fingerprint = undefined
  socket = undefined
}

export async function configureConnector(
  identity: TengriIdentity,
  connectionId: string,
  operationId: string,
  create: boolean,
  enabled: boolean,
  signal?: AbortSignal,
) {
  const context = humanContext(identity)
  const clientRequestHash = createHash('sha256').update(JSON.stringify({ connectionId, create, enabled })).digest()
  const recovered = await ofzCall(
    AuthorizationService.method.getCommand,
    { context, operationId, clientRequestHash },
    signal,
  ).catch((error) => {
    if (error instanceof OfzError && error.status === 404) return undefined
    throw error
  })
  if (recovered?.receipt) return recovered.receipt
  const state = await ofzCall(AuthorizationService.method.getPolicyState, {}, signal)
  const result = await ofzCall(
    AuthorizationService.method.executeCommand,
    {
      context,
      operationId,
      clientRequestHash,
      expectedVersion: state.version,
      reason: create
        ? 'Connect an external provider account'
        : enabled
          ? 'Reconnect an external provider account'
          : 'Disconnect an external provider account',
      command: { case: 'configureConnector', value: { connectionId, create, enabled } },
    },
    signal,
  )
  if (!result.receipt) throw new OfzError(503)
  return result.receipt
}

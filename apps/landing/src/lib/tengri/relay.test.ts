import { afterAll, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'
import { createServer, request as httpsRequest, type RequestOptions } from 'node:https'
import { fromBinary } from '@bufbuild/protobuf'
import { createSpiffeFixture } from './spiffe.fixture'
import { RequestContextSchema } from './generated/proompteng/authz/v1/authz_pb'
import type { TengriIdentity } from './auth'

void mock.module('server-only', () => ({}))
const { relayCall, closeRelayClient } = await import('./relay')
const environment = {
  RELAY_ENDPOINT: process.env.RELAY_ENDPOINT,
  SPIFFE_ENDPOINT_SOCKET: process.env.SPIFFE_ENDPOINT_SOCKET,
  SPIFFE_ID: process.env.SPIFFE_ID,
  SPIFFE_WORKLOAD_API_PROTO_PATH: process.env.SPIFFE_WORKLOAD_API_PROTO_PATH,
  TENGRI_DESKTOP_ORIGIN: process.env.TENGRI_DESKTOP_ORIGIN,
}
let fixture: Awaited<ReturnType<typeof createSpiffeFixture>> | undefined
const servers: ReturnType<typeof createServer>[] = []
afterAll(() => {
  closeRelayClient()
  for (const server of servers) {
    server.closeAllConnections()
    server.close()
  }
  fixture?.close()
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const transport = ((url: URL, options: RequestOptions, handler: Parameters<typeof httpsRequest>[2]) =>
  httpsRequest(
    url,
    {
      ...options,
      lookup: (_hostname, options, callback) =>
        options.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4),
    },
    handler,
  )) as typeof httpsRequest

test('Relay BFF uses exact SPIFFE mutual TLS and sends server-owned context without exposing credentials', async () => {
  const spiffe = await createSpiffeFixture()
  fixture = spiffe
  const relay = spiffe.certificate('relay', 'spiffe://proompteng.ai/ns/tengri/sa/tengri-connector-broker')
  const received: Record<string, unknown>[] = []
  const server = createServer(
    { key: relay.key, cert: relay.pem, ca: spiffe.bundle, requestCert: true, rejectUnauthorized: true },
    (request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        received.push(JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ providers: [] }))
      })
    },
  )
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Fixture failed')
  process.env.RELAY_ENDPOINT = `https://relay.tengri.svc.cluster.local:${address.port}`
  process.env.SPIFFE_ENDPOINT_SOCKET = spiffe.endpoint
  process.env.SPIFFE_ID = spiffe.ownId
  process.env.SPIFFE_WORKLOAD_API_PROTO_PATH = spiffe.protoPath
  process.env.TENGRI_DESKTOP_ORIGIN = 'https://proompteng.ai'
  const identity = {
    subject: 'github:424242',
    user: { id: '424242', name: 'Ada', email: 'ada@example.test', image: null },
    session: { humanId: 'a'.repeat(64), id: '11111111-1111-4111-8111-111111111111' },
  } as TengriIdentity
  expect(await relayCall({ action: 'providers' }, identity, undefined, transport)).toEqual({ providers: [] })
  const context = fromBinary(RequestContextSchema, Buffer.from(received[0]!.context as string, 'base64'))
  expect(context.actor?.identity).toEqual({ case: 'humanId', value: 'a'.repeat(64) })
  expect(context.sessionId).toBe(identity.session.id)
  expect(context.origin).toBe('https://proompteng.ai')
  expect(context.deadlineUnixMs > BigInt(Date.now())).toBe(true)
  await relayCall(
    { action: 'agentInvoke', grantId: 'grant', credential: 'scoped-grant', proof: 'proof', body: 'e30=' },
    undefined,
    undefined,
    transport,
  )
  expect(received[1]!).not.toHaveProperty('context')
  closeRelayClient()
  const wrong = spiffe.certificate('wrong-relay', 'spiffe://proompteng.ai/ns/tengri/sa/tengri')
  const wrongServer = createServer(
    { key: wrong.key, cert: wrong.pem, ca: spiffe.bundle, requestCert: true, rejectUnauthorized: true },
    (_request, response) => response.end('{}'),
  )
  servers.push(wrongServer)
  await new Promise<void>((resolve) => wrongServer.listen(0, '127.0.0.1', resolve))
  const wrongAddress = wrongServer.address()
  if (!wrongAddress || typeof wrongAddress === 'string') throw new Error('Fixture failed')
  process.env.RELAY_ENDPOINT = `https://relay.tengri.svc.cluster.local:${wrongAddress.port}`
  await assert.rejects(relayCall({ action: 'providers' }, identity, undefined, transport))
}, 15000)

import { createPrivateKey, createPublicKey, createHash, sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const seed = Buffer.from(Array.from({ length: 32 }, (_, i) => i))
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  format: 'der',
  type: 'pkcs8',
})
const publicKey = createPublicKey(key).export({ format: 'der', type: 'spki' }).subarray(-32)
const now = 1800000000000
const context = {
  protocolVersion: 3,
  actor: { kind: 'human', subject: 'a'.repeat(64), sessionId: '11111111-1111-4111-8111-111111111111' },
  action: 'ACTION_FILES_WRITE',
  workspaceUid: '22222222-2222-4222-8222-222222222222',
  runtimeEpoch: '33333333-3333-4333-8333-333333333333',
  slotEpoch: 7,
  podUid: '44444444-4444-4444-8444-444444444444',
  leaderOwner: '55555555-5555-4555-8555-555555555555',
  leaderGeneration: 9,
  recoveryGeneration: 2,
  auditReceiptId: '66666666-6666-4666-8666-666666666666',
  method: '/proompteng.runtime.guest.v1.NanoagentService/WriteFile',
  target: '/workspace/report.txt',
  bodySha256: createHash('sha256').update('fixed request bytes').digest('hex'),
  issuedAtUnixMs: now,
  deadlineUnixMs: now + 5000,
  nonce: '77777777-7777-4777-8777-777777777777',
}
function proof(payload) {
  return {
    context: Buffer.from(payload).toString('base64url'),
    signature: sign(
      null,
      Buffer.concat([Buffer.from('tengri-guest-request-v3\0'), Buffer.from(payload)]),
      key,
    ).toString('base64url'),
  }
}
const payload = JSON.stringify(context)
const invalid = []
const valid = []
function accepted(name, change, body = 'fixed request bytes') {
  const altered = structuredClone(context)
  change(altered)
  altered.bodySha256 = createHash('sha256').update(body).digest('hex')
  const payload = JSON.stringify(altered)
  valid.push({ name, body, payload, proof: proof(payload) })
}
const fileScope = {
  fileRoots: ['/workspace/reports'],
  threadIds: [],
  terminalIds: [],
  browserScreenshot: false,
  maxBytes: 512,
  maxItems: 10,
}
function scoped(c) {
  c.action = 'ACTION_FILES_OBSERVE'
  c.method = '/proompteng.runtime.guest.v1.NanoagentService/ReadFile'
  c.target = '/workspace/reports/report.txt'
  c.scope = structuredClone(fileScope)
}
accepted('scoped human', (c) => {
  c.action = 'ACTION_FILES_OBSERVE'
  c.method = '/proompteng.runtime.guest.v1.NanoagentService/ReadFile'
  c.target = '/workspace/reports/report.txt'
  c.scope = fileScope
})
accepted('scoped agent', (c) => {
  c.actor = {
    kind: 'agent',
    subject: '88888888-8888-4888-8888-888888888888',
    grantId: '99999999-9999-4999-8999-999999999999',
  }
  c.action = 'ACTION_FILES_OBSERVE'
  c.method = '/proompteng.runtime.guest.v1.NanoagentService/ReadFile'
  c.target = '/workspace/reports/report.txt'
  c.scope = fileScope
})
accepted(
  'workload probe',
  (c) => {
    c.actor = { kind: 'workload', subject: 'spiffe://example/controller', purpose: 'probe' }
    c.action = 'ACTION_WORKSPACE_METADATA_READ'
    c.method = '/proompteng.runtime.guest.v1.NanoagentService/GetInfo'
    c.target = ''
  },
  '',
)
accepted('workload terminal cleanup', (c) => {
  c.actor = { kind: 'workload', subject: 'spiffe://example/controller', purpose: 'terminalCleanup' }
  c.action = 'ACTION_TERMINAL_CONTROL'
  c.method = '/proompteng.runtime.guest.v1.NanoagentService/TerminateTerminal'
  c.target = 'terminal-42'
})
function mutation(name, change) {
  const altered = structuredClone(context)
  change(altered)
  invalid.push({ name, proof: proof(JSON.stringify(altered)) })
}
mutation('unknown action', (c) => (c.action = 'ACTION_FUTURE_ADMIN'))
mutation('retired protocol', (c) => (c.protocolVersion = 2))
mutation('nil workspace', (c) => (c.workspaceUid = '00000000-0000-0000-0000-000000000000'))
mutation('uppercase UUID', (c) => (c.workspaceUid = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'))
mutation('zero slot epoch', (c) => (c.slotEpoch = 0))
mutation('zero leader generation', (c) => (c.leaderGeneration = 0))
mutation('zero recovery generation', (c) => (c.recoveryGeneration = 0))
mutation('nil audit receipt', (c) => (c.auditReceiptId = '00000000-0000-0000-0000-000000000000'))
mutation('unknown RPC', (c) => (c.method += 'Admin'))
mutation('wrong service', (c) => (c.method = '/Other/WriteFile'))
mutation('unknown actor', (c) => (c.actor.kind = 'administrator'))
mutation('human missing session', (c) => delete c.actor.sessionId)
mutation('human extra grant', (c) => (c.actor.grantId = '88888888-8888-4888-8888-888888888888'))
mutation('human empty extra grant', (c) => (c.actor.grantId = ''))
mutation(
  'workload general content access',
  (c) => (c.actor = { kind: 'workload', subject: 'spiffe://example/controller', purpose: 'probe' }),
)
mutation('agent missing grant', (c) => (c.actor = { kind: 'agent', subject: '88888888-8888-4888-8888-888888888888' }))
mutation('expired proof', (c) => (c.deadlineUnixMs = now))
mutation('future proof', (c) => (c.issuedAtUnixMs = now + 1001))
mutation('oversized deadline', (c) => (c.deadlineUnixMs = now + 5001))
mutation('reversed deadline', (c) => (c.deadlineUnixMs = c.issuedAtUnixMs))
mutation('invalid body hash', (c) => (c.bodySha256 = 'G'.repeat(64)))
mutation('control in target', (c) => (c.target = '/workspace/\nsecret'))
mutation('oversized target', (c) => (c.target = 'a'.repeat(4097)))
mutation('replacement character', (c) => (c.target = '/workspace/\ufffd'))
mutation('unknown context field', (c) => (c.authorized = true))
mutation('missing target', (c) => delete c.target)
mutation('null target', (c) => (c.target = null))
mutation('case-insensitive field alias', (c) => {
  c.ProtocolVersion = c.protocolVersion
  delete c.protocolVersion
})
mutation('oversized scope', (c) => {
  scoped(c)
  c.scope.maxBytes = 1048577
})
mutation('unknown scope field', (c) => {
  scoped(c)
  c.scope.extra = true
})
mutation('null scope array', (c) => {
  scoped(c)
  c.scope.fileRoots = null
})
mutation('oversized payload', (c) => {
  scoped(c)
  c.scope.fileRoots = Array(3).fill('/workspace/' + 'a'.repeat(3000))
  c.target = c.scope.fileRoots[0]
})
for (const [name, target] of [
  ['outside selected root', '/workspace/other/report.txt'],
  ['root prefix confusion', '/workspace/reports-extra/report.txt'],
  ['path traversal', '/workspace/reports/../private'],
  ['credential file', '/workspace/reports/.env'],
  ['credential directory', '/workspace/reports/.ssh/key'],
]) {
  mutation(name, (c) => {
    scoped(c)
    c.target = target
  })
}
mutation('agent control action', (c) => {
  c.actor = {
    kind: 'agent',
    subject: '88888888-8888-4888-8888-888888888888',
    grantId: '99999999-9999-4999-8999-999999999999',
  }
  c.scope = fileScope
})
mutation('agent missing scope', (c) => {
  c.actor = {
    kind: 'agent',
    subject: '88888888-8888-4888-8888-888888888888',
    grantId: '99999999-9999-4999-8999-999999999999',
  }
  c.action = 'ACTION_FILES_OBSERVE'
})
mutation('observer action on write RPC', (c) => {
  scoped(c)
  c.method = '/proompteng.runtime.guest.v1.NanoagentService/WriteFile'
})
mutation('observer action on browser startup', (c) => {
  c.action = 'ACTION_BROWSER_OBSERVE'
  c.method = '/proompteng.runtime.guest.v1.NanoagentService/OpenBrowser'
  c.target = 'status'
})
for (const [name, changed] of [
  ['duplicate context field', payload.replace('"protocolVersion":3', '"protocolVersion":3,"protocolVersion":3')],
  ['duplicate actor field', payload.replace('"kind":"human"', '"kind":"human","kind":"human"')],
  ['trailing JSON', payload + '{}'],
  ['lone surrogate', payload.replace('/workspace/report.txt', '/workspace/\\ud800')],
])
  invalid.push({ name, proof: proof(changed) })
invalid.push({
  name: 'wrong signing domain',
  proof: {
    context: Buffer.from(payload).toString('base64url'),
    signature: sign(
      null,
      Buffer.concat([Buffer.from('tengri-execution-permit-v3\0'), Buffer.from(payload)]),
      key,
    ).toString('base64url'),
  },
})
const catalog = JSON.parse(readFileSync(new URL('../../ofz/operations.json', import.meta.url), 'utf8'))
const rpcActions = Object.fromEntries(
  catalog.filter((entry) => entry.surface === 'guest').map((entry) => [entry.operation, entry.action]),
)
const fixture = {
  testOnly: true,
  description: 'Public deterministic test key. Never use for deployment.',
  seedHex: seed.toString('hex'),
  publicKey: publicKey.toString('base64url'),
  nowUnixMs: now,
  body: 'fixed request bytes',
  payload,
  proof: proof(payload),
  rpcActions,
  valid,
  invalid,
}
writeFileSync(
  process.argv[2] ?? new URL('./ofz-guest-request-v3.json', import.meta.url),
  JSON.stringify(fixture, null, 2) + '\n',
)

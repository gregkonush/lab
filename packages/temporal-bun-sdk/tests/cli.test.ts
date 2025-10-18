import { describe, expect, it, mock } from 'bun:test'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TemporalConfig } from '../src/config'
import {
  parseArgs,
  inferPackageName,
  projectTemplates,
  handleCheck,
  formatTemporalAddress,
} from '../src/bin/temporal-bun.ts'

type NativeBridge = typeof import('../src/internal/core-bridge/native').native

describe('temporal-bun CLI utilities', () => {
  it('parses positional args and flags', () => {
    const { args, flags } = parseArgs(['example', '--force', '--tag', 'foo'])
    expect(args).toEqual(['example'])
    expect(flags.force).toBe(true)
    expect(flags.tag).toBe('foo')
  })

  it('infers package names safely', () => {
    expect(inferPackageName('/tmp/My Temporal Worker')).toBe('my-temporal-worker')
    expect(inferPackageName('/tmp////')).toBe('tmp')
  })

  it('writes templates without collisions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'temporal-bun-cli-'))
    const templates = projectTemplates('demo-worker')
    const seen = new Set<string>()

    for (const template of templates) {
      expect(seen.has(template.path)).toBe(false)
      seen.add(template.path)

      const fullPath = join(dir, template.path)
      await Bun.write(fullPath, template.contents)
      const contents = await readFile(fullPath, 'utf8')
      expect(contents.length).toBeGreaterThan(0)
    }

    expect(seen.has('package.json')).toBe(true)
    expect(seen.has('Dockerfile')).toBe(true)
  })

  it('normalizes Temporal addresses when missing protocol', () => {
    expect(formatTemporalAddress('localhost:7233', false)).toBe('http://localhost:7233')
    expect(formatTemporalAddress('temporal.example.com:443', true)).toBe('https://temporal.example.com:443')
    expect(formatTemporalAddress('https://already-set', false)).toBe('https://already-set')
  })

  it('handleCheck uses native bridge to describe namespace and logs result', async () => {
    const runtimeHandle = { type: 'runtime' as const, handle: 101 }
    const clientHandle = { type: 'client' as const, handle: 202 }

    const ca = Buffer.from('CA')
    const crt = Buffer.from('CRT')
    const key = Buffer.from('KEY')

    const loadConfig = mock(
      async (): Promise<TemporalConfig> => ({
        host: '127.0.0.1',
        port: 7233,
        address: 'temporal.internal:7233',
        namespace: 'default',
        taskQueue: 'prix',
        apiKey: 'temporal-api-key',
        tls: {
          serverRootCACertificate: ca,
          clientCertPair: { crt, key },
          serverNameOverride: 'temporal.example.internal',
        },
        allowInsecureTls: false,
        workerIdentity: 'temporal-bun-worker-host-1',
        workerIdentityPrefix: 'temporal-bun-worker',
      }),
    )

    const nativeBridge = {
      createRuntime: mock(() => runtimeHandle),
      runtimeShutdown: mock(() => {}),
      createClient: mock(async () => clientHandle),
      clientShutdown: mock(() => {}),
      describeNamespace: mock(async () => new Uint8Array([1, 2, 3])),
    }

    const log = mock(() => {})

    await handleCheck(
      ['analytics'],
      {},
      {
        loadConfig,
        nativeBridge: nativeBridge as unknown as NativeBridge,
        log,
      },
    )

    expect(nativeBridge.createRuntime).toHaveBeenCalledTimes(1)
    expect(nativeBridge.createClient).toHaveBeenCalledWith(
      runtimeHandle,
      expect.objectContaining({
        address: 'https://temporal.internal:7233',
        namespace: 'analytics',
        identity: 'temporal-bun-worker-host-1',
        allowInsecureTls: false,
        apiKey: 'temporal-api-key',
        tls: {
          serverRootCACertificate: ca.toString('base64'),
          clientCertPair: {
            crt: crt.toString('base64'),
            key: key.toString('base64'),
          },
          serverNameOverride: 'temporal.example.internal',
        },
      }),
    )
    expect(nativeBridge.describeNamespace).toHaveBeenCalledWith(clientHandle, 'analytics')
    expect(nativeBridge.clientShutdown).toHaveBeenCalledWith(clientHandle)
    expect(nativeBridge.runtimeShutdown).toHaveBeenCalledWith(runtimeHandle)
    expect(log.mock.calls.length).toBe(1)
    expect(log.mock.calls[0][0]).toContain('Temporal connection successful.')
  })

  it('handleCheck defaults to HTTPS when TLS is required but no protocol is provided', async () => {
    const runtimeHandle = { type: 'runtime' as const, handle: 303 }
    const clientHandle = { type: 'client' as const, handle: 404 }

    const loadConfig = mock(
      async (): Promise<TemporalConfig> => ({
        host: 'foo.tmprl.cloud',
        port: 7233,
        address: 'foo.tmprl.cloud:7233',
        namespace: 'production',
        taskQueue: 'prix',
        apiKey: undefined,
        tls: undefined,
        allowInsecureTls: false,
        workerIdentity: 'temporal-bun-worker-host-2',
        workerIdentityPrefix: 'temporal-bun-worker',
      }),
    )

    const nativeBridge = {
      createRuntime: mock(() => runtimeHandle),
      runtimeShutdown: mock(() => {}),
      createClient: mock(async () => clientHandle),
      clientShutdown: mock(() => {}),
      describeNamespace: mock(async () => new Uint8Array([4, 5, 6])),
    }

    await handleCheck(
      [],
      {},
      {
        loadConfig,
        nativeBridge: nativeBridge as unknown as NativeBridge,
      },
    )

    expect(nativeBridge.createClient).toHaveBeenCalledWith(
      runtimeHandle,
      expect.objectContaining({
        address: 'https://foo.tmprl.cloud:7233',
        allowInsecureTls: false,
        namespace: 'production',
      }),
    )
  })

  it('handleCheck falls back to HTTP when allowInsecureTls is true', async () => {
    const runtimeHandle = { type: 'runtime' as const, handle: 101 }
    const clientHandle = { type: 'client' as const, handle: 202 }

    const loadConfig = mock(
      async (): Promise<TemporalConfig> => ({
        host: '127.0.0.1',
        port: 7233,
        address: 'temporal.internal:7233',
        namespace: 'default',
        taskQueue: 'prix',
        apiKey: undefined,
        tls: undefined,
        allowInsecureTls: true,
        workerIdentity: 'temporal-bun-worker-host-1',
        workerIdentityPrefix: 'temporal-bun-worker',
      }),
    )

    const nativeBridge = {
      createRuntime: mock(() => runtimeHandle),
      runtimeShutdown: mock(() => {}),
      createClient: mock(async () => clientHandle),
      clientShutdown: mock(() => {}),
      describeNamespace: mock(async () => new Uint8Array([1])),
    }

    const log = mock(() => {})

    await handleCheck(
      ['default'],
      {},
      {
        loadConfig,
        nativeBridge: nativeBridge as unknown as NativeBridge,
        log,
      },
    )

    expect(nativeBridge.createClient).toHaveBeenCalledWith(
      runtimeHandle,
      expect.objectContaining({
        address: 'http://temporal.internal:7233',
        allowInsecureTls: true,
      }),
    )
    expect(nativeBridge.describeNamespace).toHaveBeenCalled()
  })
})

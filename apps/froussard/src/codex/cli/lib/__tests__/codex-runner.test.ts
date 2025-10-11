import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runCodexSession, pushCodexEventsToLoki } from '../codex-runner'

const bunGlobals = vi.hoisted(() => {
  const spawn = vi.fn()
  const file = vi.fn()
  ;(globalThis as unknown as { Bun?: unknown }).Bun = { spawn, file }
  return { spawn, file }
})

const spawnMock = bunGlobals.spawn
const bunFileMock = bunGlobals.file

const encoder = new TextEncoder()

const createWritable = (sink: string[]) =>
  new WritableStream<string>({
    write(chunk) {
      sink.push(chunk)
    },
  })

const createCodexProcess = (messages: string[], promptSink: string[]) => {
  const stdout = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const message of messages) {
        controller.enqueue(encoder.encode(`${message}\n`))
      }
      controller.close()
    },
  })

  return {
    stdin: createWritable(promptSink),
    stdout,
    stderr: null,
    exited: Promise.resolve(0),
  }
}

const createDiscordProcess = (relaySink: string[]) => ({
  stdin: createWritable(relaySink),
  stdout: null,
  stderr: null,
  exited: Promise.resolve(0),
  kill: vi.fn(),
})

describe('codex-runner', () => {
  let workspace: string
  const originalFetch = global.fetch

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'codex-runner-test-'))
    spawnMock.mockReset()
    bunFileMock.mockReset()
    bunFileMock.mockImplementation((path: string) => ({
      text: () => readFile(path, 'utf8'),
    }))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
    global.fetch = originalFetch
  })

  it('executes a Codex session and captures agent messages', async () => {
    const promptSink: string[] = []
    const codexMessages = [
      JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'hello world' } }),
    ]
    spawnMock.mockImplementation(() => createCodexProcess(codexMessages, promptSink))

    const outputPath = join(workspace, 'output.log')
    const jsonOutputPath = join(workspace, 'events.jsonl')
    const agentOutputPath = join(workspace, 'agent.log')
    const result = await runCodexSession({
      stage: 'planning',
      prompt: 'Plan please',
      outputPath,
      jsonOutputPath,
      agentOutputPath,
    })

    expect(result.agentMessages).toEqual(['hello world'])
    expect(promptSink).toEqual(['Plan please'])
    expect(await readFile(jsonOutputPath, 'utf8')).toContain('hello world')
    expect(await readFile(agentOutputPath, 'utf8')).toContain('hello world')
  })

  it('streams output to a Discord relay when configured', async () => {
    const relaySink: string[] = []
    const promptSink: string[] = []
    const discordProcess = createDiscordProcess(relaySink)
    const codexProcess = createCodexProcess(
      [JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'relay copy' } })],
      promptSink,
    )

    spawnMock.mockImplementationOnce(() => discordProcess).mockImplementationOnce(() => codexProcess)

    const outputPath = join(workspace, 'output.log')
    const jsonOutputPath = join(workspace, 'events.jsonl')
    const agentOutputPath = join(workspace, 'agent.log')

    await runCodexSession({
      stage: 'implementation',
      prompt: 'Implement',
      outputPath,
      jsonOutputPath,
      agentOutputPath,
      discordRelay: {
        command: ['bun', 'run', 'discord-relay.ts'],
      },
    })

    expect(relaySink.some((chunk) => chunk.includes('relay copy'))).toBe(true)
  })

  it('pushes Loki payloads when events exist', async () => {
    const jsonPath = join(workspace, 'events.jsonl')
    await writeFile(
      jsonPath,
      [
        JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'message' } }),
        JSON.stringify({ type: 'info', detail: 'done' }),
      ].join('\n'),
      'utf8',
    )

    const fetchMock = vi.fn(async () => ({ ok: true }))
    global.fetch = fetchMock as unknown as typeof fetch

    await pushCodexEventsToLoki('planning', jsonPath, 'https://loki.example.com/api/v1/push')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const body = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body
    expect(typeof body).toBe('string')
    expect(body as string).toContain('codex-exec')
  })

  it('throws when Codex exits with a non-zero status', async () => {
    const promptSink: string[] = []
    spawnMock.mockImplementation(() => ({
      stdin: createWritable(promptSink),
      stdout: new ReadableStream<Uint8Array>({ start: (controller) => controller.close() }),
      stderr: null,
      exited: Promise.resolve(2),
    }))

    await expect(
      runCodexSession({
        stage: 'planning',
        prompt: 'fail',
        outputPath: join(workspace, 'output.log'),
        jsonOutputPath: join(workspace, 'events.jsonl'),
        agentOutputPath: join(workspace, 'agent.log'),
      }),
    ).rejects.toThrow('Codex exited with status 2')
  })

  it('invokes the relay error handler when the Discord relay fails to start', async () => {
    const relaySink: string[] = []
    const promptSink: string[] = []
    const discordProcess = {
      stdin: createWritable(relaySink),
      stdout: null,
      stderr: null,
      exited: Promise.resolve(1),
      kill: vi.fn(),
    }
    const codexProcess = createCodexProcess([], promptSink)

    spawnMock.mockImplementationOnce(() => discordProcess).mockImplementationOnce(() => codexProcess)

    const errorSpy = vi.fn()

    await runCodexSession({
      stage: 'planning',
      prompt: 'relay',
      outputPath: join(workspace, 'output.log'),
      jsonOutputPath: join(workspace, 'events.jsonl'),
      agentOutputPath: join(workspace, 'agent.log'),
      discordRelay: {
        command: ['bun', 'run', 'relay.ts'],
        onError: errorSpy,
      },
    })

    expect(errorSpy).toHaveBeenCalled()
  })

  it('skips Loki export when the events file is missing', async () => {
    bunFileMock.mockImplementation(() => ({
      text: () => Promise.reject(Object.assign(new Error('not found'), { code: 'ENOENT' })),
    }))

    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch

    await pushCodexEventsToLoki('planning', join(workspace, 'missing.jsonl'), 'https://loki.example.com/api/v1/push')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

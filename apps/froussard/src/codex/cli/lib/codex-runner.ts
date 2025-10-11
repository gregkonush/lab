import { createWriteStream, type WriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import process from 'node:process'
import { ensureFileDirectory } from './fs'
import { consoleLogger, type CodexLogger } from './logger'

export interface DiscordRelayOptions {
  command: string[]
  onError?: (error: Error) => void
}

export interface RunCodexSessionOptions {
  stage: 'planning' | 'implementation'
  prompt: string
  outputPath: string
  jsonOutputPath: string
  agentOutputPath: string
  discordRelay?: DiscordRelayOptions
  logger?: CodexLogger
}

export interface RunCodexSessionResult {
  agentMessages: string[]
}

export interface PushCodexEventsToLokiOptions {
  stage: string
  endpoint?: string
  jsonPath?: string
  agentLogPath?: string
  runtimeLogPath?: string
  labels?: Record<string, string | undefined>
  tenant?: string
  basicAuth?: string
  logger?: CodexLogger
}

const decoder = new TextDecoder()

interface WritableHandle {
  write: (chunk: string) => Promise<void>
  close: () => Promise<void>
}

const createWritableHandle = (stream: unknown): WritableHandle | undefined => {
  if (!stream) {
    return undefined
  }

  const candidate = stream as {
    getWriter?: () => WritableStreamDefaultWriter<string>
    write?: (chunk: string) => unknown
    flush?: () => Promise<unknown> | unknown
    end?: () => unknown
    close?: () => Promise<unknown> | unknown
  }

  if (typeof candidate.getWriter === 'function') {
    const writer = candidate.getWriter()
    return {
      write: async (chunk: string) => {
        await writer.write(chunk)
      },
      close: async () => {
        await writer.close()
      },
    }
  }

  if (typeof candidate.write === 'function') {
    return {
      write: async (chunk: string) => {
        candidate.write(chunk)
        if (typeof candidate.flush === 'function') {
          try {
            await candidate.flush()
          } catch {
            // ignore flush errors; fallback to best effort
          }
        }
      },
      close: async () => {
        if (typeof candidate.end === 'function') {
          candidate.end()
        } else if (typeof candidate.close === 'function') {
          await candidate.close()
        }
      },
    }
  }

  return undefined
}

const writeLine = (stream: WriteStream, content: string) => {
  return new Promise<void>((resolve, reject) => {
    stream.write(`${content}\n`, (error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

const closeStream = (stream: WriteStream) => {
  return new Promise<void>((resolve, reject) => {
    stream.end((error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })
}

export const runCodexSession = async ({
  stage,
  prompt,
  outputPath,
  jsonOutputPath,
  agentOutputPath,
  discordRelay,
  logger,
}: RunCodexSessionOptions): Promise<RunCodexSessionResult> => {
  const log = logger ?? consoleLogger

  await Promise.all([
    ensureFileDirectory(outputPath),
    ensureFileDirectory(jsonOutputPath),
    ensureFileDirectory(agentOutputPath),
  ])

  const jsonStream = createWriteStream(jsonOutputPath, { flags: 'w' })
  const agentStream = createWriteStream(agentOutputPath, { flags: 'w' })

  let discordProcess: ReturnType<typeof Bun.spawn> | undefined
  let discordWriter: WritableHandle | undefined
  let discordClosed = false

  if (discordRelay) {
    try {
      discordProcess = Bun.spawn({
        cmd: discordRelay.command,
        stdin: 'pipe',
        stdout: 'inherit',
        stderr: 'inherit',
      })
      const handle = createWritableHandle(discordProcess.stdin)
      if (handle) {
        discordWriter = handle
      } else {
        log.warn('Discord relay process did not expose stdin; disabling relay')
        discordProcess.kill()
        discordProcess = undefined
        discordWriter = undefined
      }
    } catch (error) {
      if (discordRelay.onError && error instanceof Error) {
        discordRelay.onError(error)
      } else {
        log.error('Failed to start Discord relay:', error)
      }
    }
  }

  const codexProcess = Bun.spawn({
    cmd: [
      'codex',
      'exec',
      '--dangerously-bypass-approvals-and-sandbox',
      '--json',
      '--output-last-message',
      outputPath,
      '-',
    ],
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
    env: {
      ...process.env,
      CODEX_STAGE: stage,
    },
  })

  const codexStdin = createWritableHandle(codexProcess.stdin)
  if (!codexStdin) {
    throw new Error('Codex subprocess is missing stdin')
  }

  await codexStdin.write(prompt)
  await codexStdin.close()

  const agentMessages: string[] = []
  const reader = codexProcess.stdout?.getReader()
  let buffer = ''

  if (!reader) {
    throw new Error('Codex subprocess is missing stdout')
  }

  const flushLine = async (line: string) => {
    if (!line.trim()) {
      return
    }

    await writeLine(jsonStream, line)

    try {
      const parsed = JSON.parse(line)
      const item = parsed?.item
      if (parsed?.type === 'item.completed' && item?.type === 'agent_message' && typeof item?.text === 'string') {
        const message = item.text
        agentMessages.push(message)
        await writeLine(agentStream, message)
        if (discordWriter && !discordClosed) {
          try {
            await discordWriter.write(`${message}\n`)
          } catch (error) {
            discordClosed = true
            await discordWriter.close().catch(() => {})
            if (discordRelay?.onError && error instanceof Error) {
              discordRelay.onError(error)
            } else {
              log.error('Failed to write to Discord relay stream:', error)
            }
          }
        }
      }
    } catch (error) {
      log.error('Failed to parse Codex event line as JSON:', error)
    }
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    buffer += decoder.decode(value, { stream: true })

    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex)
      buffer = buffer.slice(newlineIndex + 1)
      await flushLine(line)
      newlineIndex = buffer.indexOf('\n')
    }
  }

  const remaining = buffer.trim()
  if (remaining) {
    await flushLine(remaining)
  }

  await closeStream(jsonStream)
  await closeStream(agentStream)

  if (discordWriter && !discordClosed) {
    await discordWriter.close()
    discordClosed = true
  }

  const codexExitCode = await codexProcess.exited
  if (codexExitCode !== 0) {
    throw new Error(`Codex exited with status ${codexExitCode}`)
  }

  if (discordProcess) {
    const discordExit = await discordProcess.exited
    if (discordExit !== 0 && discordRelay?.onError) {
      discordRelay.onError(new Error(`Discord relay exited with status ${discordExit}`))
    }
  }

  return { agentMessages }
}

export const pushCodexEventsToLoki = async ({
  stage,
  endpoint,
  jsonPath,
  agentLogPath,
  runtimeLogPath,
  labels,
  tenant,
  basicAuth,
  logger,
}: PushCodexEventsToLokiOptions) => {
  if (!endpoint) {
    return
  }

  const log = logger ?? consoleLogger
  const baseLabels = buildLokiLabels(stage, labels)
  const nextTimestamp = createTimestampGenerator()
  const streams: LokiStreamPayload[] = []

  if (jsonPath) {
    const jsonLines = await loadLogLines(jsonPath, 'Codex JSON event log', log)
    if (jsonLines && jsonLines.length > 0) {
      const values: Array<[string, string]> = []
      jsonLines.forEach((line) => {
        try {
          const payload = JSON.stringify(JSON.parse(line))
          values.push([nextTimestamp(), payload])
        } catch (error) {
          log.error('Skipping Codex event line that failed to parse for Loki export:', error)
        }
      })
      if (values.length > 0) {
        streams.push({
          stream: { ...baseLabels, stream_type: 'json', source: 'codex-events' },
          values,
        })
      } else {
        log.warn('Codex JSON event payload empty after parsing; skipping Loki export')
      }
    }
  }

  if (agentLogPath) {
    const agentLines = await loadLogLines(agentLogPath, 'Codex agent log', log)
    if (agentLines && agentLines.length > 0) {
      streams.push({
        stream: { ...baseLabels, stream_type: 'agent', source: 'codex-agent' },
        values: agentLines.map<[string, string]>((line) => [nextTimestamp(), line]),
      })
    }
  }

  if (runtimeLogPath) {
    const runtimeLines = await loadLogLines(runtimeLogPath, 'Codex runtime log', log)
    if (runtimeLines && runtimeLines.length > 0) {
      streams.push({
        stream: { ...baseLabels, stream_type: 'runtime', source: 'codex-runtime' },
        values: runtimeLines.map<[string, string]>((line) => [nextTimestamp(), line]),
      })
    }
  }

  if (streams.length === 0) {
    log.warn('No Codex log payloads available; skipping Loki export')
    return
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (tenant) {
    headers['X-Scope-OrgID'] = tenant
  }

  if (basicAuth) {
    headers.Authorization = basicAuth.startsWith('Basic ') ? basicAuth : `Basic ${basicAuth}`
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ streams }),
    })

    if (!response.ok) {
      log.error(`Failed to push Codex events to Loki at ${endpoint}: ${response.status} ${response.statusText}`)
    } else {
      log.info(`Pushed Codex events to Loki at ${endpoint}`)
    }
  } catch (error) {
    log.error('Failed to push Codex events to Loki:', error)
  }
}

const loadLogLines = async (path: string, description: string, log: CodexLogger) => {
  try {
    const stats = await stat(path)
    if (stats.size === 0) {
      log.warn(`${description} is empty; skipping log export`)
      return undefined
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      log.warn(`${description} not found at ${path}; skipping log export`)
      return undefined
    }
    throw error
  }

  const raw = await Bun.file(path).text()
  const lines: string[] = []

  raw.split(/\r?\n/).forEach((line) => {
    if (line.trim().length > 0) {
      lines.push(line)
    }
  })

  if (lines.length === 0) {
    log.warn(`${description} payload empty after parsing; skipping log export`)
    return undefined
  }

  return lines
}

const createTimestampGenerator = () => {
  const base = BigInt(Date.now()) * 1_000_000n
  let offset = 0n
  return () => {
    const timestamp = base + offset
    offset += 1n
    return timestamp.toString()
  }
}

const buildLokiLabels = (stage: string, labels?: Record<string, string | undefined>): Record<string, string> => {
  const result: Record<string, string> = {
    job: 'codex-exec',
  }

  const stageValue = sanitizeLabelValue(stage)
  if (stageValue) {
    result.stage = stageValue
  }

  if (labels) {
    for (const [key, value] of Object.entries(labels)) {
      if (!key || value === undefined || value === null) {
        continue
      }
      const sanitizedKey = sanitizeLabelKey(key)
      if (!sanitizedKey || sanitizedKey === 'stage' || sanitizedKey === 'job') {
        continue
      }
      const sanitizedValue = sanitizeLabelValue(value)
      if (!sanitizedValue) {
        continue
      }
      result[sanitizedKey] = sanitizedValue
    }
  }

  return result
}

const sanitizeLabelKey = (key: string) => key.trim().replace(/[^A-Za-z0-9_]/g, '_')

const sanitizeLabelValue = (value: unknown) => {
  if (value === undefined || value === null) {
    return ''
  }
  const normalized = `${value}`.trim()
  return normalized === 'null' ? '' : normalized
}

const isNotFoundError = (error: unknown): error is NodeJS.ErrnoException => {
  if (!(error instanceof Error)) {
    return false
  }
  return 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

interface LokiStreamPayload {
  stream: Record<string, string>
  values: Array<[string, string]>
}

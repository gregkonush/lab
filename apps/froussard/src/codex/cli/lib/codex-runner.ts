import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'

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
}

export interface RunCodexSessionResult {
  agentMessages: string[]
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

export const ensureFileDirectory = async (filePath: string) => {
  await mkdir(dirname(filePath), { recursive: true })
}

export const runCodexSession = async ({
  stage,
  prompt,
  outputPath,
  jsonOutputPath,
  agentOutputPath,
  discordRelay,
}: RunCodexSessionOptions): Promise<RunCodexSessionResult> => {
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
        console.error('Discord relay process did not expose stdin; disabling relay')
        discordProcess.kill()
        discordProcess = undefined
        discordWriter = undefined
      }
    } catch (error) {
      if (discordRelay.onError && error instanceof Error) {
        discordRelay.onError(error)
      } else {
        console.error('Failed to start Discord relay:', error)
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
              console.error('Failed to write to Discord relay stream:', error)
            }
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse Codex event line as JSON:', error)
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

export const pushCodexEventsToLoki = async (stage: string, jsonPath: string, endpoint?: string) => {
  if (!endpoint) {
    return
  }

  try {
    const stats = await stat(jsonPath)
    if (stats.size === 0) {
      console.error('Codex JSON event log is empty; skipping log export')
      return
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      console.error(`Codex JSON event log not found at ${jsonPath}; skipping log export`)
      return
    }
    throw error
  }

  const raw = await Bun.file(jsonPath).text()
  const lines = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    console.error('Codex JSON event payload empty; skipping log export')
    return
  }

  const baseTimestampNs = BigInt(Date.now()) * 1_000_000n
  const values: Array<[string, string]> = []

  lines.forEach((line, index) => {
    try {
      const parsed = JSON.parse(line)
      const payload = JSON.stringify(parsed)
      const timestamp = (baseTimestampNs + BigInt(index)).toString()
      values.push([timestamp, payload])
    } catch (error) {
      console.error('Skipping Codex event line that failed to parse for Loki export:', error)
    }
  })

  if (values.length === 0) {
    console.error('Codex JSON event payload empty after parsing; skipping log export')
    return
  }

  const body = JSON.stringify({
    streams: [
      {
        stream: { job: 'codex-exec', stage },
        values,
      },
    ],
  })

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body,
    })

    if (!response.ok) {
      console.error(`Failed to push Codex events to Loki at ${endpoint}: ${response.status} ${response.statusText}`)
    } else {
      console.error(`Pushed Codex events to Loki at ${endpoint}`)
    }
  } catch (error) {
    console.error('Failed to push Codex events to Loki:', error)
  }
}

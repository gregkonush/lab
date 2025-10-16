import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export const fatal = (message: string, error?: unknown): never => {
  if (error instanceof Error) {
    console.error(`${message}\n${error.message}`)
  } else if (error) {
    console.error(`${message}\n${String(error)}`)
  } else {
    console.error(message)
  }
  process.exit(1)
}

export const ensureCli = (binary: string) => {
  if (!Bun.which(binary)) {
    fatal(`Required CLI '${binary}' is not available in PATH`)
  }
}

type RunOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
}

const buildEnv = (env?: Record<string, string | undefined>) => {
  const source = env ? { ...process.env, ...env } : process.env
  return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== undefined)) as Record<string, string>
}

export const run = async (command: string, args: string[], options: RunOptions = {}) => {
  console.log(`$ ${command} ${args.join(' ')}`.trim())
  const subprocess = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: buildEnv(options.env),
    stdout: 'inherit',
    stderr: 'inherit',
  })

  const exitCode = await subprocess.exited
  if (exitCode !== 0) {
    fatal(`Command failed (${exitCode}): ${command} ${args.join(' ')}`)
  }
}

const currentDir = fileURLToPath(new URL('.', import.meta.url))
export const repoRoot = resolve(currentDir, '../../../..')

#!/usr/bin/env bun
import { $, which } from 'bun'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { runCli } from './lib/cli'
import { fileURLToPath } from 'node:url'

const pathExists = async (path: string) => {
  try {
    await stat(path)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

const ensureFile = async (path: string, description: string) => {
  if (!(await pathExists(path))) {
    throw new Error(`${description} not found: ${path}`)
  }
}

const loadGitHubToken = async (): Promise<string> => {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  if (token) {
    return token
  }

  try {
    const ghCli = await which('gh')
    if (!ghCli) {
      throw new Error('gh CLI not found; please install gh or export GH_TOKEN')
    }
    const output = await $`${ghCli} auth token`.text()
    const trimmed = output.trim()
    if (trimmed) {
      return trimmed
    }
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message ? error.message : 'Set GH_TOKEN environment variable or login with gh',
    )
  }

  throw new Error('Set GH_TOKEN environment variable or login with gh')
}

const computeChecksum = async (path: string) => {
  const data = await readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

export const runBuildCodexImage = async () => {
  const scriptDir = dirname(fileURLToPath(import.meta.url))
  const rootDir = resolve(scriptDir, '../../..')
  const dockerfile = process.env.DOCKERFILE ?? resolve(rootDir, 'apps/froussard/Dockerfile.codex')
  const imageTag = process.env.IMAGE_TAG ?? 'registry.ide-newton.ts.net/lab/codex-universal:latest'
  const contextDir = process.env.CONTEXT_DIR ?? rootDir
  const codexAuthPath = process.env.CODEX_AUTH ?? `${process.env.HOME ?? ''}/.codex/auth.json`
  const codexConfigPath = process.env.CODEX_CONFIG ?? `${process.env.HOME ?? ''}/.codex/config.toml`

  await ensureFile(dockerfile, 'Dockerfile')
  await ensureFile(codexAuthPath, 'Codex auth file')
  await ensureFile(codexConfigPath, 'Codex config file')

  const checksum = await computeChecksum(codexAuthPath)

  const githubToken = await loadGitHubToken()
  const tempDir = await mkdtemp(join(tmpdir(), 'codex-build-'))
  const ghTokenFile = join(tempDir, 'gh_token')
  await writeFile(ghTokenFile, githubToken, { encoding: 'utf8', mode: 0o600 })

  process.env.DOCKER_BUILDKIT = process.env.DOCKER_BUILDKIT ?? '1'

  try {
    console.log(`Building ${imageTag} from ${dockerfile}`)
    await $`docker build -f ${dockerfile} --build-arg CODEX_AUTH_CHECKSUM=${checksum} --secret id=codex_auth,src=${codexAuthPath} --secret id=codex_config,src=${codexConfigPath} --secret id=github_token,src=${ghTokenFile} -t ${imageTag} ${contextDir}`

    console.log(`Pushing ${imageTag}`)
    await $`docker push ${imageTag}`
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }

  return { imageTag }
}

await runCli(import.meta, async () => {
  await runBuildCodexImage()
})

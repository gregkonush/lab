#!/usr/bin/env bun
import { $, spawn, which } from 'bun'
import { rm, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { runCli } from './lib/cli'

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

const ensureParentDir = async (path: string) => {
  await mkdir(dirname(path), { recursive: true })
}

export const runCodexBootstrap = async (argv: string[] = process.argv.slice(2)) => {
  const repoUrl = process.env.REPO_URL ?? 'https://github.com/gregkonush/lab'
  const worktreeDefault = process.env.WORKTREE ?? '/workspace/lab'
  const targetDir = process.env.TARGET_DIR ?? worktreeDefault
  const baseBranch = process.env.BASE_BRANCH ?? 'main'
  const headBranch = process.env.HEAD_BRANCH ?? ''

  process.env.WORKTREE = worktreeDefault
  process.env.TARGET_DIR = targetDir
  process.env.BASE_BRANCH = baseBranch
  process.env.HEAD_BRANCH = headBranch

  await ensureParentDir(targetDir)

  const gitDir = join(targetDir, '.git')
  const git = $({ cwd: targetDir })

  if (await pathExists(gitDir)) {
    await git`git fetch --all --prune`
    await git`git reset --hard origin/${baseBranch}`
  } else {
    await rm(targetDir, { recursive: true, force: true })
    await $`gh repo clone ${repoUrl} ${targetDir}`
    await $({ cwd: targetDir })`git checkout ${baseBranch}`
  }

  process.chdir(targetDir)

  if (argv.length === 0) {
    return 0
  }

  const command = argv[0]!
  const commandPath = (await which(command)) ?? command
  const child = spawn({
    cmd: [commandPath, ...argv.slice(1)],
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
    cwd: targetDir,
  })

  const exitCode = await child.exited
  return exitCode ?? 0
}

await runCli(import.meta, async () => runCodexBootstrap())

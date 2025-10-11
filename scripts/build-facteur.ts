#!/usr/bin/env bun

const registry = process.env.FACTEUR_IMAGE_REGISTRY ?? 'registry.ide-newton.ts.net'
const repository = process.env.FACTEUR_IMAGE_REPOSITORY ?? 'lab/facteur'
const tag = process.env.FACTEUR_IMAGE_TAG ?? 'latest'
const image = `${registry}/${repository}:${tag}`
const context = process.env.FACTEUR_BUILD_CONTEXT ?? '.'
const dockerfile = process.env.FACTEUR_DOCKERFILE ?? 'services/facteur/Dockerfile'
const version = process.env.FACTEUR_VERSION ?? execGit(['describe', '--tags', '--always'])
const commit = process.env.FACTEUR_COMMIT ?? execGit(['rev-parse', 'HEAD'])

function envSummary() {
  return { image, context, dockerfile, version, commit }
}

async function run(cmd: string, args: string[]) {
  console.log(['$', cmd, ...args].join(' '))
  const proc = Bun.spawn([cmd, ...args], { stdout: 'inherit', stderr: 'inherit' })
  await proc.exited
  if (proc.exitCode !== 0) {
    throw new Error(`Command failed (${proc.exitCode}): ${cmd} ${args.join(' ')}`)
  }
}

function execGit(args: string[]): string {
  const result = Bun.spawnSync(['git', ...args])
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed`)
  }
  return result.stdout.toString().trim()
}

async function main() {
  console.log('Building Facteur image with configuration:', envSummary())
  await run('docker', [
    'build',
    '-f',
    dockerfile,
    '-t',
    image,
    '--build-arg',
    `FACTEUR_VERSION=${version}`,
    '--build-arg',
    `FACTEUR_COMMIT=${commit}`,
    context,
  ])
  await run('docker', ['push', image])
  console.log(`Image pushed: ${image}`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})

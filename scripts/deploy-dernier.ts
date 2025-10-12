#!/usr/bin/env bun

import { $, type ShellExpression } from 'bun'

$.throws(true)

function splitArgs(value: string | undefined) {
  return value
    ? value
        .split(/\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
    : []
}

const registry = process.env.DERNIER_IMAGE_REGISTRY ?? 'registry.ide-newton.ts.net'
const repository = process.env.DERNIER_IMAGE_REPOSITORY ?? 'lab/dernier'
const tag = process.env.DERNIER_IMAGE_TAG ?? (await $`git rev-parse --short HEAD`.text()).trim()
const image = `${registry}/${repository}:${tag}`

const context = process.env.DERNIER_BUILD_CONTEXT ?? 'services/dernier'
const dockerfile = process.env.DERNIER_DOCKERFILE ?? 'services/dernier/Dockerfile'
const namespace = process.env.DERNIER_KN_NAMESPACE ?? 'dernier'
const service = process.env.DERNIER_KN_SERVICE ?? 'dernier'
const knBinary = process.env.DERNIER_KN_BIN ?? 'kn'

const buildArgs = splitArgs(process.env.DERNIER_BUILD_ARGS)
const knExtraArgs = splitArgs(process.env.DERNIER_KN_EXTRA_ARGS)

const buildCommand: ShellExpression[] = ['docker', 'build', '-f', dockerfile, '-t', image, ...buildArgs, context]

console.log('$', ['docker', 'build', '-f', dockerfile, '-t', image, ...buildArgs, context].join(' '))
await $`${buildCommand as any}`

await $`docker push ${image}`
console.log(`Image pushed: ${image}`)

const deployCommand: ShellExpression[] = [
  knBinary,
  'service',
  'update',
  service,
  '-n',
  namespace,
  '--image',
  image,
  ...knExtraArgs,
]

console.log('$', [knBinary, 'service', 'update', service, '-n', namespace, '--image', image, ...knExtraArgs].join(' '))
await $`${deployCommand as any}`
console.log(`Updated Knative service ${service} in namespace ${namespace}`)

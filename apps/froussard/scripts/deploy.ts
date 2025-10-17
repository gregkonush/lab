#!/usr/bin/env bun
import { writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { $ } from 'bun'
import YAML from 'yaml'

const ignoredAnnotations = new Set(['kubectl.kubernetes.io/last-applied-configuration', 'client.knative.dev/nonce'])

const namespace = process.env.FROUSSARD_NAMESPACE?.trim() || 'froussard'
const service = process.env.FROUSSARD_SERVICE?.trim() || 'froussard'
const manifestRelativePath =
  process.env.FROUSSARD_KNATIVE_MANIFEST?.trim() || 'argocd/applications/froussard/knative-service.yaml'

const run = async () => {
  $.throws(true)

  const envVersion = process.env.FROUSSARD_VERSION?.trim()
  const envCommit = process.env.FROUSSARD_COMMIT?.trim()

  const version =
    envVersion && envVersion.length > 0 ? envVersion : (await $`git describe --tags --always`.text()).trim()
  const commit = envCommit && envCommit.length > 0 ? envCommit : (await $`git rev-parse HEAD`.text()).trim()

  if (!version) {
    throw new Error('Failed to determine FROUSSARD_VERSION')
  }
  if (!commit) {
    throw new Error('Failed to determine FROUSSARD_COMMIT')
  }

  console.log(`Deploying froussard version ${version} (${commit})`)

  const env = {
    ...process.env,
    FROUSSARD_VERSION: version,
    FROUSSARD_COMMIT: commit,
  }

  const args = Bun.argv.slice(2)
  const passThrough = args.length > 0 ? ['--', ...args] : []

  await $.env(env)`pnpm --filter froussard run deploy ${passThrough}`

  await exportKnativeManifest({
    namespace,
    service,
    manifestPath: manifestRelativePath,
  })
}

void run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

async function exportKnativeManifest({
  namespace: exportNamespace,
  service: exportService,
  manifestPath,
}: {
  namespace: string
  service: string
  manifestPath: string
}) {
  const manifestJson = await $`kubectl get ksvc ${exportService} --namespace ${exportNamespace} -o json`.text()
  const parsed = JSON.parse(manifestJson)

  const container = parsed?.spec?.template?.spec?.containers?.[0]
  if (!container || typeof container !== 'object') {
    throw new Error(`Unable to resolve container spec for service ${exportService}`)
  }

  const sanitizeObject = (value: Record<string, unknown> | undefined) => {
    if (!value) return undefined
    const entries = Object.entries(value).filter(
      ([key, v]) =>
        !ignoredAnnotations.has(key) &&
        v !== undefined &&
        v !== null &&
        !(typeof v === 'string' && v.trim().length === 0),
    )
    if (entries.length === 0) {
      return undefined
    }
    return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)))
  }

  const env = Array.isArray(container.env)
    ? container.env
        .filter((entry: unknown): entry is { name: string; value?: string; valueFrom?: unknown } => {
          return (
            !!entry &&
            typeof entry === 'object' &&
            typeof (entry as { name?: unknown }).name === 'string' &&
            (('value' in (entry as object) && typeof (entry as { value?: unknown }).value === 'string') ||
              'valueFrom' in (entry as object))
          )
        })
        .filter((entry) => entry.name !== 'BUILT')
        .map((entry) => {
          if ('valueFrom' in entry && entry.valueFrom) {
            return { name: entry.name, valueFrom: entry.valueFrom }
          }
          return { name: entry.name, value: entry.value ?? '' }
        })
    : []

  const baseDir = dirname(fileURLToPath(import.meta.url))
  const repoRoot = join(baseDir, '..', '..', '..')
  const manifestAbsolutePath = join(repoRoot, manifestPath)

  const sanitizeResources = (value: unknown): unknown => {
    if (value === undefined || value === null) {
      return undefined
    }

    if (Array.isArray(value)) {
      const sanitizedArray = value
        .map((entry) => sanitizeResources(entry))
        .filter((entry) => entry !== undefined) as unknown[]
      return sanitizedArray.length > 0 ? sanitizedArray : []
    }

    if (typeof value !== 'object') {
      if (typeof value === 'string' && value.trim().length === 0) {
        return undefined
      }
      return value
    }

    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const sanitized = sanitizeResources(entry)
      if (sanitized === undefined) {
        continue
      }

      if (Array.isArray(sanitized)) {
        result[key] = sanitized
        continue
      }

      if (typeof sanitized === 'object' && sanitized !== null && Object.keys(sanitized).length === 0) {
        result[key] = sanitized
        continue
      }

      result[key] = sanitized
    }

    return Object.keys(result).length > 0 ? result : {}
  }

  const annotations = sanitizeObject(parsed?.metadata?.annotations) ?? {}
  const templateAnnotations = sanitizeObject(parsed?.spec?.template?.metadata?.annotations) ?? {}

  const knServiceAccount = 'system:serviceaccount:argocd:argocd-application-controller'
  annotations['serving.knative.dev/creator'] = knServiceAccount
  annotations['serving.knative.dev/lastModifier'] = knServiceAccount
  templateAnnotations['serving.knative.dev/creator'] = knServiceAccount
  templateAnnotations['serving.knative.dev/lastModifier'] = knServiceAccount

  const sanitizedManifest = {
    apiVersion: 'serving.knative.dev/v1',
    kind: 'Service',
    metadata: {
      name: parsed?.metadata?.name ?? exportService,
      namespace: parsed?.metadata?.namespace ?? exportNamespace,
      annotations,
      labels: sanitizeObject(parsed?.metadata?.labels),
    },
    spec: {
      template: {
        metadata: {
          annotations: templateAnnotations,
          labels: sanitizeObject(parsed?.spec?.template?.metadata?.labels),
        },
        spec: {
          containerConcurrency: parsed?.spec?.template?.spec?.containerConcurrency ?? 0,
          timeoutSeconds: parsed?.spec?.template?.spec?.timeoutSeconds ?? 300,
          enableServiceLinks: parsed?.spec?.template?.spec?.enableServiceLinks ?? false,
          containers: [
            {
              name: container.name ?? 'user-container',
              image: container.image,
              env,
              readinessProbe: container.readinessProbe,
              livenessProbe: container.livenessProbe,
              resources: sanitizeResources(container.resources),
              securityContext:
                container.securityContext && Object.keys(container.securityContext).length > 0
                  ? container.securityContext
                  : undefined,
            },
          ],
        },
      },
    },
  }

  const manifestYaml = `---\n${YAML.stringify(sanitizedManifest, { lineWidth: 120 })}`
  await writeFile(manifestAbsolutePath, manifestYaml)

  console.log(
    `Exported Knative service manifest to ${relative(process.cwd(), manifestAbsolutePath)}. Please commit the updated file.`,
  )
}

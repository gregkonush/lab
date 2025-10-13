#!/usr/bin/env bun

/**
 * Synchronise repository protobuf schemas with a Karapace / Schema Registry instance.
 *
 * The manifest (default: proto/schema-subjects.json) lists each source file and the
 * registry subjects that should receive it. Use --dry-run (default for PR builds)
 * to preview registrations without touching the registry.
 */

import { parseArgs } from 'node:util'
import { readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'

type Reference = {
  name: string
  subject: string
  version: number
}

type SubjectEntry = {
  name: string
  references?: Reference[]
}

type ManifestEntry = {
  file: string
  subjects: SubjectEntry[]
  references?: Reference[]
}

type Manifest = {
  schemas: ManifestEntry[]
}

const { values } = parseArgs({
  options: {
    manifest: {
      type: 'string',
      default: 'proto/schema-subjects.json',
    },
    'proto-root': {
      type: 'string',
      default: 'proto',
    },
    'karapace-url': {
      type: 'string',
      default: process.env.KARAPACE_URL ?? '',
    },
    username: {
      type: 'string',
      default: process.env.KARAPACE_USER ?? '',
    },
    password: {
      type: 'string',
      default: process.env.KARAPACE_PASSWORD ?? '',
    },
    'dry-run': {
      type: 'boolean',
      default: false,
    },
  },
})

const manifestPath = resolve(values.manifest)
const protoRoot = resolve(values['proto-root'])
const baseUrl = values['karapace-url']
const username = values.username
const password = values.password
const dryRun = values['dry-run']

if (!baseUrl && !dryRun) {
  console.error('KARAPACE_URL must be provided via flag or environment')
  process.exit(1)
}

const manifest: Manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

if (!Array.isArray(manifest.schemas)) {
  console.error(`Manifest ${manifestPath} missing 'schemas' array`)
  process.exit(1)
}

const sortedEntries = [...manifest.schemas].sort((a, b) => a.file.localeCompare(b.file))

const authHeader =
  username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : undefined

async function register(subject: string, schemaSource: string, references: Reference[] | undefined): Promise<void> {
  if (dryRun || !baseUrl) {
    console.log(`[dry-run] would register ${subject} (${schemaSource.length} bytes)`)
    return
  }

  const payload: Record<string, unknown> = {
    schemaType: 'PROTOBUF',
    schema: schemaSource,
  }

  if (Array.isArray(references) && references.length > 0) {
    payload.references = references
  }

  const response = await fetch(`${baseUrl}/subjects/${encodeURIComponent(subject)}/versions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/vnd.schemaregistry.v1+json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Failed to register ${subject}: ${response.status} ${body}`)
  }

  const json = (await response.json()) as { id?: number; version?: number }
  console.log(`Registered ${subject} (id=${json.id ?? '?'}, version=${json.version ?? '?'})`)
}

for (const entry of sortedEntries) {
  if (!entry.file || !Array.isArray(entry.subjects) || entry.subjects.length === 0) {
    console.warn(`Skipping invalid manifest entry: ${JSON.stringify(entry)}`)
    continue
  }

  const schemaText = await readFile(join(protoRoot, entry.file), 'utf8')
  const baseReferences = entry.references ?? []

  for (const subject of entry.subjects) {
    const refs = subject.references ?? baseReferences
    await register(subject.name, schemaText, refs)
  }
}

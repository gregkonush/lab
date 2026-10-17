import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import YAML from 'yaml'

const source = 'a'.repeat(40)
const schema = '1'.repeat(64)
const prefix = 'registry.ide-newton.ts.net/lab/'
const services = ['ofz', 'tengri', 'proompteng']
const warehouses = YAML.parseAllDocuments(
  readFileSync(resolve(import.meta.dir, '../../../../argocd/applications/kargo/warehouses.yaml'), 'utf8'),
).flatMap((document) => {
  const name = document.getIn(['metadata', 'name'])
  if (typeof name !== 'string' || !services.includes(name)) return []
  const expression = document.getIn(['spec', 'freightCreationCriteria', 'expression'])
  if (typeof expression !== 'string') throw new Error(`Warehouse ${name} requires promotion criteria`)
  return [{ name, expression }]
})

type Artifact = { Tag: string; Annotations: Record<string, string> }

function artifacts(): Record<string, Artifact> {
  const images: Record<string, Artifact> = {}
  for (const service of [...services, 'nanoagent']) {
    images[prefix + service] = {
      Tag: `kargo-sha-${source}${service === 'ofz' ? '-run-17' : ''}`,
      Annotations: {
        'org.opencontainers.image.source': 'https://github.com/proompteng/lab',
        'org.opencontainers.image.revision': source,
        'ai.proompteng.github-actions-run-id': '17',
        'ai.proompteng.github-actions-build-conclusion': 'success',
        'ai.proompteng.tengri-schema': schema,
      },
    }
  }
  return images
}

function eligible(expression: string, images: ReturnType<typeof artifacts>) {
  return (
    runInNewContext(expression, {
      imageFrom: (repository: string) => images[repository],
      commitFrom: () => ({ ID: source }),
      nil: undefined,
    }) === true
  )
}

describe('Tengri schema promotion cohort', () => {
  it('admits all three services only when the published schema contracts match', () => {
    expect(warehouses).toHaveLength(3)
    for (const value of warehouses) expect(eligible(value.expression, artifacts())).toBe(true)
  })

  it('holds every service when any consumer has a different or missing schema contract', () => {
    for (const service of services) {
      for (const mismatch of ['2'.repeat(64), '', undefined]) {
        const images = artifacts()
        const annotations: Record<string, string> = images[prefix + service].Annotations
        if (mismatch === undefined) delete annotations['ai.proompteng.tengri-schema']
        else annotations['ai.proompteng.tengri-schema'] = mismatch
        for (const value of warehouses) expect(eligible(value.expression, images)).toBe(false)
      }
    }
  })

  it('allows independent releases when existing companion images implement the same schema', () => {
    for (const value of warehouses) {
      const images = artifacts()
      for (const service of services.filter((service) => service !== value.name)) {
        images[prefix + service].Annotations['org.opencontainers.image.revision'] = 'b'.repeat(40)
        images[prefix + service].Tag = `kargo-sha-${'b'.repeat(40)}${service === 'ofz' ? '-run-17' : ''}`
      }
      expect(eligible(value.expression, images)).toBe(true)
    }
  })
})

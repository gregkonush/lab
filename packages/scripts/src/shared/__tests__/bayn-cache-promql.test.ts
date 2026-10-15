import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'bun:test'
import YAML from 'yaml'

const runPromtool = (files: Readonly<Record<string, string>>) => {
  const directory = mkdtempSync(join(tmpdir(), 'bayn-cache-promql-'))
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(directory, name), content)
    const result = spawnSync(process.env.PROMTOOL ?? 'promtool', ['test', 'rules', 'tests.yaml'], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 30_000,
    })
    if (result.error !== undefined || result.status !== 0)
      throw new Error(`Native PromQL evaluation failed: ${result.error ?? ''}\n${result.stdout}\n${result.stderr}`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('Bayn cache alerts evaluate healthy, missing, failed and low-traffic observations with native PromQL', () => {
  const manifest = YAML.parse(
    readFileSync(
      new URL('../../../../../argocd/applications/observability/graf-mimir-rules.yaml', import.meta.url),
      'utf8',
    ),
  )
  runPromtool({
    'rules.yaml': manifest.data['graf-rules.yaml'],
    'tests.yaml': readFileSync(
      new URL('../../../../../argocd/applications/observability/tests/bayn-cache-alerts.yaml', import.meta.url),
      'utf8',
    ),
  })
}, 30_000)

type MetricPanel = {
  readonly type: 'stat' | 'timeseries' | 'bargauge' | 'logs'
  readonly title: string
  readonly targets: readonly { readonly expr: string; readonly legendFormat?: string }[]
}
type DashboardPanel = MetricPanel | { readonly type: 'row'; readonly panels: readonly DashboardPanel[] }
const metricPanels = (panels: readonly DashboardPanel[]): readonly MetricPanel[] =>
  panels.flatMap((panel) => (panel.type === 'row' ? metricPanels(panel.panels) : [panel]))

test('Bayn dashboard requires both replica observations and retains buffer-pin waits', () => {
  const manifest = YAML.parse(
    readFileSync(
      new URL(
        '../../../../../argocd/applications/observability/bayn-cache-performance-dashboard-configmap.yaml',
        import.meta.url,
      ),
      'utf8',
    ),
  )
  const dashboard: { readonly panels: readonly DashboardPanel[] } = JSON.parse(
    manifest.data['bayn-cache-performance.json'],
  )
  const panels = metricPanels(dashboard.panels)
  const replica = panels
    .find((panel) => panel.title === 'Cache health')
    ?.targets.find((target) => target.legendFormat === 'Replica link')?.expr
  const waits = panels.find((panel) => panel.title === 'Database I/O and lock waits')?.targets[0]?.expr
  if (replica === undefined || waits === undefined) throw new Error('Required Bayn dashboard query is missing')
  const cacheSeries = (metric: string, pod: string, value: number) => ({
    series: `${metric}{job="bayn-valkey",namespace="bayn",pod="${pod}"}`,
    values: `${value}+0x10`,
  })
  const observations = [
    { name: 'both sides connected', primary: 1, replica: 1, primaryScrape: 1, expected: 1 },
    { name: 'primary sees no replica', primary: 0, replica: 1, primaryScrape: 1, expected: 0 },
    { name: 'replica link disconnected', primary: 1, replica: 0, primaryScrape: 1, expected: 0 },
    { name: 'primary exporter down with stale observation', primary: 1, replica: 1, primaryScrape: 0, expected: 0 },
    { name: 'primary observation missing', primary: null, replica: 1, primaryScrape: 1, expected: null },
    { name: 'replica observation missing', primary: 1, replica: null, primaryScrape: 1, expected: null },
  ]
  const tests = observations.map((observation) => ({
    name: observation.name,
    interval: '1m',
    input_series: [
      cacheSeries('up', 'primary', observation.primaryScrape),
      cacheSeries('up', 'replica', 1),
      ...(observation.primary === null ? [] : [cacheSeries('redis_connected_slaves', 'primary', observation.primary)]),
      ...(observation.replica === null ? [] : [cacheSeries('redis_master_link_up', 'replica', observation.replica)]),
    ],
    promql_expr_test: [
      {
        expr: replica,
        eval_time: '10m',
        exp_samples: observation.expected === null ? [] : [{ labels: '{}', value: observation.expected }],
      },
    ],
  }))
  const bufferPin =
    'cnpg_bayn_waits_backends{namespace="bayn",cluster="bayn-db",role="primary",wait_event_type="BufferPin",wait_event="BufferPin"}'
  const walSync =
    'cnpg_bayn_waits_backends{namespace="bayn",cluster="bayn-db",role="primary",wait_event_type="IO",wait_event="WALSync"}'
  tests.push({
    name: 'buffer pins and WAL waits remain visible while idle clients are excluded',
    interval: '1m',
    input_series: [
      { series: bufferPin, values: '2+0x10' },
      { series: walSync, values: '1+0x10' },
      {
        series:
          'cnpg_bayn_waits_backends{namespace="bayn",cluster="bayn-db",role="primary",wait_event_type="Client",wait_event="ClientRead"}',
        values: '9+0x10',
      },
    ],
    promql_expr_test: [
      {
        expr: waits,
        eval_time: '10m',
        exp_samples: [
          { labels: bufferPin, value: 2 },
          { labels: walSync, value: 1 },
        ],
      },
    ],
  })
  runPromtool({ 'tests.yaml': YAML.stringify({ evaluation_interval: '1m', tests }) })
}, 30_000)

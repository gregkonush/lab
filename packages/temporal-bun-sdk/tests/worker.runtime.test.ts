import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import { WorkerRuntime, type ActivityRegistryInput } from '../src/worker/runtime.ts'
import { native as workerNative } from '../src/internal/worker/native.ts'
import {
  native as coreNative,
  type NativeClient,
  type Runtime as NativeRuntime,
} from '../src/internal/core-bridge/native.ts'
import type { NativeWorker } from '../src/internal/worker/native.ts'

const WORKFLOWS_PATH = fileURLToPath(new URL('./fixtures/workflows/example-workflows.ts', import.meta.url))
const textEncoder = new TextEncoder()

const encode = (payload: unknown): Uint8Array => textEncoder.encode(JSON.stringify(payload))

const wait = async (ms: number): Promise<void> => await new Promise((resolve) => setTimeout(resolve, ms))

const waitFor = async (predicate: () => boolean, timeoutMs = 1_000, intervalMs = 10): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for condition')
    }
    await wait(intervalMs)
  }
}

describe('WorkerRuntime', () => {
  const originalWorkerNative = { ...workerNative }
  const originalCoreNative = { ...coreNative }

  let workflowTasks: Uint8Array[]
  let activityTasks: Uint8Array[]
  let workflowCompletions: unknown[]
  let activityCompletions: unknown[]
  let heartbeats: unknown[]
  let shutdownCalls: number
  let finalizeCalls: number
  let workerFreed: boolean
  let runtimeShutdownCalls: number
  let clientShutdownCalls: number

  const runtimeHandle: NativeRuntime = { type: 'runtime', handle: 101 }
  const clientHandle: NativeClient = { type: 'client', handle: 202 }
  const workerHandle: NativeWorker = { type: 'worker', handle: 303 }

  beforeEach(() => {
    workflowTasks = []
    activityTasks = []
    workflowCompletions = []
    activityCompletions = []
    heartbeats = []
    shutdownCalls = 0
    finalizeCalls = 0
    workerFreed = false
    runtimeShutdownCalls = 0
    clientShutdownCalls = 0

    workerNative.createWorker = mock(() => workerHandle)
    workerNative.workerShutdown = mock(() => {
      workerFreed = true
    })
    workerNative.pollWorkflowTask = mock(() => workflowTasks.shift() ?? null)
    workerNative.pollActivityTask = mock(() => activityTasks.shift() ?? null)
    workerNative.completeWorkflowTask = mock((_worker, payload: unknown) => {
      workflowCompletions.push(payload)
    })
    workerNative.completeActivityTask = mock((_worker, payload: unknown) => {
      activityCompletions.push(payload)
    })
    workerNative.recordActivityHeartbeat = mock((_worker, payload: unknown) => {
      heartbeats.push(payload)
    })
    workerNative.initiateShutdown = mock(() => {
      shutdownCalls += 1
    })
    workerNative.finalizeShutdown = mock(() => {
      finalizeCalls += 1
    })

    coreNative.createRuntime = mock(() => runtimeHandle)
    coreNative.runtimeShutdown = mock(() => {
      runtimeShutdownCalls += 1
    })
    coreNative.createClient = mock(async () => clientHandle)
    coreNative.clientShutdown = mock(() => {
      clientShutdownCalls += 1
    })
  })

  afterEach(() => {
    Object.assign(workerNative, originalWorkerNative)
    Object.assign(coreNative, originalCoreNative)
  })

  test('processes workflow tasks and completes', async () => {
    const runtime = await createRuntime({ activities: {} })
    const runPromise = runtime.run()

    workflowTasks.push(
      encode({
        taskToken: 'wf-1',
        runId: 'run-1',
        workflowId: 'workflow-1',
        workflowType: 'exampleWorkflow',
        job: { type: 'start', args: ['Temporal Bun'] },
      }),
    )

    await waitFor(() => workflowCompletions.length === 1)

    expect(workflowCompletions[0]).toEqual({
      taskToken: 'wf-1',
      runId: 'run-1',
      workflowId: 'workflow-1',
      status: 'completed',
      result: 'Hello, Temporal Bun!',
    })

    await runtime.shutdown()
    await runPromise

    expect(shutdownCalls).toBe(1)
    expect(finalizeCalls).toBe(1)
    expect(workerFreed).toBe(true)
  })

  test('records heartbeats for long running activities', async () => {
    const activities: ActivityRegistryInput = {
      slowEcho: async (value: string) => {
        await wait(150)
        return `activity:${value}`
      },
    }

    const runtime = await createRuntime({ activities })
    const runPromise = runtime.run()

    activityTasks.push(
      encode({
        taskToken: 'activity-1',
        activityType: 'slowEcho',
        args: ['payload'],
        heartbeatTimeoutMs: 200,
      }),
    )

    await waitFor(() => activityCompletions.length === 1)

    expect(activityCompletions[0]).toEqual({
      taskToken: 'activity-1',
      workflowRunId: undefined,
      workflowId: undefined,
      status: 'completed',
      result: 'activity:payload',
    })
    expect(heartbeats.length).toBeGreaterThanOrEqual(1)
    expect(heartbeats[0]).toEqual({
      taskToken: 'activity-1',
      details: null,
    })

    await runtime.shutdown()
    await runPromise
  })

  test('shutdown finalizes native worker lifecycle', async () => {
    const runtime = await createRuntime({ activities: {} })
    const runPromise = runtime.run()

    await wait(20)

    await runtime.shutdown()
    await runPromise

    expect(shutdownCalls).toBe(1)
    expect(finalizeCalls).toBe(1)
    expect(workerFreed).toBe(true)
    expect(clientShutdownCalls).toBe(1)
    expect(runtimeShutdownCalls).toBe(1)
  })

  const createRuntime = async ({
    activities = {},
    workflowsPath = WORKFLOWS_PATH,
  }: {
    activities?: ActivityRegistryInput
    workflowsPath?: string
  }): Promise<WorkerRuntime> => {
    return await WorkerRuntime.create({
      workflowsPath,
      activities,
      taskQueue: 'test-task-queue',
      namespace: 'default',
      concurrency: { workflow: 1, activity: 1 },
      clientOptions: {
        address: '127.0.0.1:7233',
        namespace: 'default',
        identity: 'worker-runtime-test',
      },
    })
  }
})

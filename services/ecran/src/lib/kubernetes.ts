import * as k8s from '@kubernetes/client-node'
import { PassThrough } from 'node:stream'
import { executeJavaCode } from './javaExecutor'
import { db } from '@/db'
import { executions, users } from '@/db/schema'
import { auth } from '@/auth'
import { eq } from 'drizzle-orm'

export async function execute(
  code: string,
  language: 'javascript' | 'typescript' | 'python' | 'java',
): Promise<NodeJS.ReadableStream> {
  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()

  const namespace = 'ecran'
  let podName: string
  let containerName: string
  let command: string[]

  const exec = new k8s.Exec(kc)

  switch (language) {
    case 'javascript':
    case 'typescript': {
      podName = await getStandbyPod(kc, namespace, 'app=js-ts-standby')
      containerName = 'bun-executor'
      const filename = language === 'typescript' ? 'script.ts' : 'script.js'
      const runCommand = `bun run ${filename}`
      command = ['/bin/sh', '-c', `echo '${code.replace(/'/g, "'\\''")}' > ${filename} && ${runCommand}`]
      break
    }

    case 'python':
      podName = await getStandbyPod(kc, namespace, 'app=python-standby')
      containerName = 'python-executor'
      command = ['/bin/sh', '-c', `echo "${code.replace(/"/g, '\\"')}" > script.py && python script.py`]
      break

    case 'java':
      return executeJavaCode(code)

    default:
      throw new Error(`Unsupported language: ${language}`)
  }

  const stdoutStream = new PassThrough()
  const stderrStream = new PassThrough()
  const outputStream = new PassThrough()

  const outputChunks: Buffer[] = []

  stdoutStream.on('data', (chunk) => {
    outputChunks.push(chunk)
  })

  stderrStream.on('data', (chunk) => {
    outputChunks.push(chunk)
  })

  exec
    .exec(
      namespace,
      podName,
      containerName,
      command,
      stdoutStream,
      stderrStream,
      null,
      false,
      (status: k8s.V1Status) => {
        if (status.status !== 'Success') {
          stderrStream.write(`Execution failed: ${status.message || 'Unknown error'}\n`)
        }
        stdoutStream.end()
        stderrStream.end()
      },
    )
    .catch((err) => {
      stderrStream.write(`Error: ${err.message}\n`)
      stdoutStream.end()
      stderrStream.end()
    })

  stdoutStream.pipe(outputStream, { end: false })
  stderrStream.pipe(outputStream, { end: false })

  let streamsEnded = 0
  function checkAndCloseOutputStream() {
    streamsEnded++
    if (streamsEnded === 2 && !outputStream.destroyed) {
      outputStream.end()
    }
  }

  stdoutStream.on('end', checkAndCloseOutputStream)
  stderrStream.on('end', checkAndCloseOutputStream)

  stdoutStream.on('error', (err) => {
    console.error('StdoutStream error:', err)
    if (!outputStream.destroyed) {
      outputStream.end()
    }
  })

  stderrStream.on('error', (err) => {
    console.error('StderrStream error:', err)
    if (!outputStream.destroyed) {
      outputStream.end()
    }
  })

  outputStream.on('error', (err) => {
    console.error('OutputStream error:', err)
  })

  outputStream.on('end', async () => {
    const output = Buffer.concat(outputChunks).toString()
    await saveExecution(code, output, language)
  })

  return outputStream
}

async function getStandbyPod(kc: k8s.KubeConfig, namespace: string, labelSelector: string): Promise<string> {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
  const res = await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, labelSelector)

  if (res.body.items.length === 0) {
    throw new Error(`No standby pods available for selector: ${labelSelector}`)
  }

  const podName = res.body.items[0]?.metadata?.name
  if (!podName) {
    throw new Error('No standby pod available')
  }

  return podName
}

export async function saveExecution(
  code: string,
  output: string,
  language: 'javascript' | 'typescript' | 'python' | 'java',
) {
  const userSession = await auth()
  await db.insert(executions).values({
    code,
    output,
    language,
    userId: userSession?.user?.id,
  })
}

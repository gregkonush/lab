import * as k8s from '@kubernetes/client-node'
import { PassThrough } from 'stream'

export async function executeJavaCodeStream(code: string): Promise<NodeJS.ReadableStream> {
  const kc = new k8s.KubeConfig()
  kc.loadFromDefault()

  const namespace = 'ecran'
  const podName = await getJavaStandbyPod(kc, namespace)

  const exec = new k8s.Exec(kc)

  const command = ['/bin/sh', '-c', `echo '${code.replace(/'/g, "'\\''")}' > Main.java && javac Main.java && java Main`]

  const stdoutStream = new PassThrough()
  const stderrStream = new PassThrough()
  const outputStream = new PassThrough()

  exec
    .exec(
      namespace,
      podName,
      'java-executor',
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

  // Combine stdout and stderr streams
  stdoutStream.pipe(outputStream, { end: false })
  stderrStream.pipe(outputStream, { end: false })

  let streamsEnded = 0
  function checkAndCloseOutputStream() {
    streamsEnded++
    if (streamsEnded === 2) {
      if (!outputStream.destroyed) {
        outputStream.end()
      }
    }
  }

  stdoutStream.on('end', checkAndCloseOutputStream)
  stderrStream.on('end', checkAndCloseOutputStream)

  // Handle errors to prevent "write after end"
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

  return outputStream
}

async function getJavaStandbyPod(kc: k8s.KubeConfig, namespace: string): Promise<string> {
  const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
  const res = await k8sApi.listNamespacedPod(namespace, undefined, undefined, undefined, undefined, 'app=java-standby')

  if (res.body.items.length === 0) {
    throw new Error('No Java standby pods available')
  }

  const podName = res.body.items[0]?.metadata?.name
  if (!podName) {
    throw new Error('No Java standby pod available')
  }

  return podName
}

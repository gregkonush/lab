import { PassThrough } from 'node:stream'
import * as net from 'node:net'

const MESSAGE_DELIMITER = '\n<<END_OF_MESSAGE>>\n'
const CODE_DELIMITER = '\n<<END_OF_CODE>>\n'

export async function executeJavaCode(code: string): Promise<NodeJS.ReadableStream> {
  const namespace = 'ecran'
  const serviceName = 'juge-service'
  const port = 9090
  let host = '127.0.0.1'

  if (process.env.NODE_ENV === 'production') {
    host = `${serviceName}.${namespace}.svc.cluster.local`
  }

  console.log(`Connecting to ${host}:${port}...`)
  const socket = net.createConnection({ host, port }, () => {
    console.log('Connected to server')
    console.log('Sending code:\n', code)
    socket.write(`${code}${CODE_DELIMITER}`)
  })

  const outputStream = new PassThrough()

  let buffer = ''
  socket.on('data', (data) => {
    console.log('Received data from server:', data.toString())
    buffer += data.toString()

    const endMessageIndex = buffer.indexOf(MESSAGE_DELIMITER)
    if (endMessageIndex !== -1) {
      const output = buffer.substring(0, endMessageIndex)
      console.log('Full output received:', output)
      outputStream.write(output)
      outputStream.end()
      socket.end()
    }
  })

  socket.on('end', () => {
    console.log('Disconnected from server')
    if (buffer.length > 0) {
      console.log('Remaining buffer:', buffer)
      outputStream.write(buffer)
      outputStream.end()
    }
  })

  socket.on('error', (err) => {
    console.error('Socket error:', err)
    outputStream.write(`Error: ${err.message}\n`)
    outputStream.end()
  })

  socket.on('timeout', () => {
    console.error('Socket timeout')
    socket.destroy()
    outputStream.write('Error: Connection timeout\n')
    outputStream.end()
  })

  return outputStream
}

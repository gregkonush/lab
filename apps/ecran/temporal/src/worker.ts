import { NativeConnection, Worker } from '@temporalio/worker'
import * as activities from './activities'
import { TASK_QUEUE_NAME } from './shared'
import './workflows'

run().catch((err) => console.log(err))

async function run() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233'
  console.log('Starting worker, address:', address)
  const connection = await NativeConnection.connect({
    address,
  })
  try {
    const worker = await Worker.create({
      connection,
      workflowsPath: require.resolve('./workflows'),
      activities,
      taskQueue: TASK_QUEUE_NAME,
    })
    await worker.run()
  } finally {
    connection.close()
  }
}

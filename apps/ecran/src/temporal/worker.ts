import { NativeConnection, Worker } from '@temporalio/worker'
import * as activities from './activities'
import { PROBLEMS_QUEUE_NAME } from './shared'
import './workflows'

run().catch((err) => console.log(err))
const workflowOption = () =>
  process.env.NODE_ENV === 'production'
    ? {
        workflowBundle: {
          codePath: require.resolve('./workflow-bundle.js'),
        },
      }
    : { workflowsPath: require.resolve('./workflows') }

async function run() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233'
  console.log('Starting worker, address:', address)
  const connection = await NativeConnection.connect({
    address,
  })
  try {
    const worker = await Worker.create({
      connection,
      ...workflowOption(),
      activities,
      taskQueue: PROBLEMS_QUEUE_NAME,
    })
    await worker.run()
  } finally {
    connection.close()
  }
}

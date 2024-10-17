import { NativeConnection, Worker } from '@temporalio/worker'
import * as activities from './activities/solve-problem'
import { PROBLEMS_QUEUE_NAME } from './shared'

async function run() {
  const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233'
  console.log('Starting worker, address:', address)

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set')
  }

  const connection = await NativeConnection.connect({
    address,
  })
  try {
    const worker = await Worker.create({
      connection,
      workflowsPath: require.resolve('./workflows/index.ts'),
      bundlerOptions: {
        webpackConfigHook: (config) => {
          config.module?.rules?.push({
            test: /\.tsx?$/,
            use: 'esbuild-loader',
            exclude: /node_modules/,
          })
          return config
        },
      },
      namespace: 'default',
      activities,
      taskQueue: PROBLEMS_QUEUE_NAME,
    })
    await worker.run()
  } finally {
    connection.close()
  }
}

run().catch((err) => console.log(err))

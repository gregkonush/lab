import { proxyActivities } from '@proompteng/temporal-bun-sdk/workflow'
import type { Activities } from '../activities/index.ts'

const activities = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
})

export async function helloWorkflow(name: string): Promise<string> {
  await activities.sleep(10)
  return await activities.echo({ message: `Hello, ${name}!` })
}

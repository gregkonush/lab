import { proxyActivities } from '@temporalio/workflow'

type Activities = {
  echoActivity: (input: { message: string }) => Promise<string>
  sleepActivity: (milliseconds: number) => Promise<void>
}

const activities = proxyActivities<Activities>({
  startToCloseTimeout: '1 minute',
})

export const helloTemporal = async (name: string): Promise<string> => {
  await activities.sleepActivity(10)
  return await activities.echoActivity({ message: `Hello, ${name}!` })
}

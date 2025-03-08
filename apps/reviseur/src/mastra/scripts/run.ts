import { githubAgent } from '../agents/github.ts'

const run = async () => {
  const result = await githubAgent.generate([
    {
      role: 'user',
      content: 'Review the PR https://github.com/gregkonush/lab/pull/723',
    },
  ])
  console.log(result)
}

run().then(() => {
  console.log('Done')
  process.exit(0)
})

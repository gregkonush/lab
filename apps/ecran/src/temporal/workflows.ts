import { proxyActivities } from '@temporalio/workflow'
import type * as activities from './activities'

const { askClaude, persistSolution } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 minutes',
})

export async function solveProblem(problemId: string, problemStatement: string): Promise<string> {
  const solution = await askClaude(problemStatement)
  console.log('Solution has been generated: ', solution)
  const solutionId = await persistSolution(problemId, solution)
  return solutionId
}

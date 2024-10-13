import { proxyActivities, log } from '@temporalio/workflow'
import type * as Activities from '../activities'

const { askClaude, persistSolution, generateCodeTemplates, persistCodeTemplates } = proxyActivities<typeof Activities>({
  startToCloseTimeout: '5 minutes',
})

export async function solveProblem(problemId: string, problemStatement: string): Promise<string> {
  log.info('Received problem statement: ', { problemStatement })
  const solution = await askClaude(problemStatement)
  log.info('Solution has been generated: ', { solution })

  log.info('Generating code templates')
  const generatedTemplates = await generateCodeTemplates(problemStatement, problemId)
  log.info('Code templates have been generated: ', { generatedTemplates })
  const persistedTemplates = await persistCodeTemplates(generatedTemplates)

  const solutionId = await persistSolution(problemId, solution)
  return solutionId
}

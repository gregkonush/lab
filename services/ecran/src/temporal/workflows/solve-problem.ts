import { proxyActivities, log } from '@temporalio/workflow'
import { createMachine } from 'xstate'

import type * as Activities from '../activities/solve-problem'

const { askClaude, persistSolution, generateCodeTemplates, persistCodeTemplates, updateProblem } = proxyActivities<
  typeof Activities
>({
  startToCloseTimeout: '5 minutes',
})

export async function solveProblem(problemId: string, problemStatement: string): Promise<string> {
  log.info('Received problem statement: ', { problemStatement })
  const { solution, tags, difficulty } = await askClaude(problemStatement)
  log.info('Solution has been generated: ', { solution })
  await updateProblem(problemId, { tags, difficulty })

  log.info('Generating code templates')
  const generatedTemplates = await generateCodeTemplates(problemStatement, problemId)
  log.info('Code templates have been generated: ', { generatedTemplates })
  await persistCodeTemplates(generatedTemplates)

  const solutionId = await persistSolution(problemId, solution)
  return solutionId
}

const crackerMachine = createMachine({
  id: 'crackerMachine',
  initial: 'fetchProblem',
  states: {
    fetchProblem: {
      entry: () => console.log('fetchProblem'),
    },
    solveProblem: {
      entry: () => console.log('solveProblem'),
    },
    persistSolution: {
      type: 'final',
      entry: () => console.log('persistSolution'),
    },
  },
})

export async function solveDailyQuestion(): Promise<void> {}

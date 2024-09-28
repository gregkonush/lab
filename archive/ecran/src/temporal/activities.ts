import '@anthropic-ai/sdk/shims/node'
import { activityInfo } from '@temporalio/activity'
import anthropic from './anthropic'
import { db } from '@/db'
import { solutions } from '@/db/schema'
import { SYSTEM_SOLVER_PROMPT } from '@/temporal/prompts/solver'

export async function askClaude(problemStatement: string): Promise<string> {
  console.log(`Solving problem: ${problemStatement}`)
  const message = await anthropic.messages.create({
    max_tokens: 1024,
    temperature: 0.1,
    system: SYSTEM_SOLVER_PROMPT,
    messages: [{ role: 'user', content: problemStatement }],
    model: 'claude-3-5-sonnet-20240620',
  })

  const result = message.content.map((c) => {
    if (c.type === 'text') {
      return c.text
    }
  })
  return result.join('\n')
}

export async function persistSolution(problemId: string, solution: string): Promise<string> {
  console.log(`Persisting solution with problemId: ${problemId} and solution: ${solution}`)
  const solutionRow = await db
    .insert(solutions)
    .values({
      problemId,
      solution,
    })
    .returning()
  const solutionId = solutionRow.at(0)?.id

  if (!solutionId) {
    throw new Error('Failed to persist solution')
  }

  return solutionId
}

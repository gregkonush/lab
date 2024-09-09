import '@anthropic-ai/sdk/shims/node'
import { activityInfo } from '@temporalio/activity'
import anthropic from './anthropic'
import { db } from '@/db'
import { problems, solutions } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function purchase(id: string): Promise<string> {
  console.log(`Purchased ${id}!`)
  return activityInfo().activityId
}

export async function askClaude(problemStatement: string): Promise<string> {
  console.log(`Solving problem: ${problemStatement}`)
  const message = await anthropic.messages.create({
    max_tokens: 1024,
    system:
      'You are proffesional software engineer, you can solve any technical interview problem. You are tasked with solving a problem. Use python to solve the problem. Explain space complexity and time complexity of the solution. Add comments to the code where possible.',
    messages: [{ role: 'user', content: problemStatement }],
    model: 'claude-3-opus-20240229',
  })

  const result = message.content.map((c) => {
    if (c.type === 'text') {
      return c.text
    }
  })
  return result.join('\n')
}

export async function persistSolution(problemId: string, solution: string): Promise<string> {
  console.log(`Persisting solution: ${solution}`)
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

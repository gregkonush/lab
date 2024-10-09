'use server'

import { problems, solutions } from '@/db/schema'
import { db } from '@/db'
import { redirect } from 'next/navigation'
import { eq, type InferSelectModel } from 'drizzle-orm'
import { temporalClient } from '@/temporal/client'
import { PROBLEMS_QUEUE_NAME } from '@/temporal/shared'
import type { solveProblem } from '@/temporal/workflows'
import { logger } from '@/utils/logger'
import { revalidatePath } from 'next/cache'

type Problem = InferSelectModel<typeof problems>

export async function createProblem(formData: FormData) {
  const title = formData.get('title') as string
  const difficulty = formData.get('difficulty') as Problem['difficulty']
  const description = formData.get('description') as string
  const tags = formData.get('tags') as string

  // Validation
  if (!title || !difficulty || !description || !tags) {
    return { error: 'All fields are required' }
  }

  try {
    const result = await db
      .insert(problems)
      .values({
        title,
        difficulty,
        description,
        tags: [tags] as Problem['tags'],
      })
      .returning({ id: problems.id, description: problems.description })

    const problemId = result.at(0)?.id

    if (!problemId) {
      return { error: 'Failed to create problem' }
    }

    logger.info(`Created problem ${problemId} with description ${description}`)

    await temporalClient.workflow.start<typeof solveProblem>('solveProblem', {
      taskQueue: PROBLEMS_QUEUE_NAME,
      workflowId: problemId,
      args: [problemId, description],
    })
    logger.info(`Started solving problem ${problemId}`)

    redirect(`/problems/${problemId}`)
  } catch (error) {
    logger.error('Error creating problem:', error)
    return { error: 'An error occurred while creating the problem' }
  }
}

export async function checkIfSolutionExists(problemId: string | undefined) {
  if (!problemId) {
    logger.error('No problemId provided')
    return
  }
  logger.info(`Checking if solution exists for problem ${problemId}`)
  const solution = await db.select().from(solutions).where(eq(solutions.problemId, problemId))
  if (solution.length > 0) {
    logger.info(`Revalidating problem ${problemId}`)
    revalidatePath(`/problems/${problemId}`)
  } else {
    logger.info(`No solution found for problem ${problemId}`)
  }
}

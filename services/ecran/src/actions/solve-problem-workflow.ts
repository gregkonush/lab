'use server'

import { temporalClient } from '@/temporal/client'
import { PROBLEMS_QUEUE_NAME } from '@/temporal/shared'
import type { solveProblem as SolveProblemWorkflow } from '@/temporal/workflows'
import { problems } from '@/db/schema'
import { db } from '@/db'
import { eq } from 'drizzle-orm'
import { logger } from '@/utils/logger'
import { z } from 'zod'
import { revalidatePath } from 'next/cache'

const startWorkflowSchema = z.string().uuid()

export async function startSolveProblemWorkflow(problemId: string) {
  try {
    const validatedId = startWorkflowSchema.parse(problemId)

    const [problem] = await db.select().from(problems).where(eq(problems.id, validatedId))

    if (!problem) {
      return { error: 'Problem not found' }
    }

    const description = problem.description || problem.descriptionHtml
    if (!description) {
      return { error: 'Problem description not found' }
    }

    logger.info(`Starting solve problem workflow for problem ${problem.id}`)

    await temporalClient.workflow.execute<typeof SolveProblemWorkflow>('solveProblem', {
      taskQueue: PROBLEMS_QUEUE_NAME,
      workflowId: problem.id,
      args: [problem.id, description],
    })
    revalidatePath(`/problems/${problem.id}`)

    return { success: true }
  } catch (error) {
    logger.error('Failed to start solve problem workflow', { error, problemId })
    return {
      error: error instanceof z.ZodError ? 'Invalid problem ID' : 'Failed to start problem solver',
    }
  }
}

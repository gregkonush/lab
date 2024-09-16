'use server'

import { problems } from '@/db/schema'
import { db } from '@/db'
import { redirect } from 'next/navigation'
import { InferSelectModel } from 'drizzle-orm'
import { getTemporalClient } from '@/temporal/client'
import { PROBLEMS_QUEUE_NAME } from '@/temporal/shared'
import { solveProblem } from '@/temporal/workflows'
import { logger } from '@/utils/logger'

type Problem = InferSelectModel<typeof problems>

export async function createProblem(data: FormData) {
  const result = await db
    .insert(problems)
    .values({
      title: data.get('title') as string,
      difficulty: data.get('difficulty') as Problem['difficulty'],
      description: data.get('description') as string,
      tags: [data.get('tags')] as Problem['tags'],
    })
    .returning({ id: problems.id, description: problems.description })

  const problemId = result.at(0)?.id
  const description = result.at(0)?.description

  if (!problemId || !description) {
    return { error: 'Failed to create problem' }
  }
  logger.info(`Created problem ${problemId} with description ${description}`)

  await getTemporalClient().workflow.start<typeof solveProblem>('solveProblem', {
    taskQueue: PROBLEMS_QUEUE_NAME,
    workflowId: problemId,
    args: [problemId, description],
  })
  logger.info(`Started solving problem ${problemId}`)

  redirect(`/problems/${problemId}`)
}

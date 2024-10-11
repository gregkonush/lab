import { db } from '@/db'
import { problems } from '@/db/schema'
import { temporalClient } from '@/temporal/client'
import { PROBLEMS_QUEUE_NAME } from '@/temporal/shared'
import type { solveProblem } from '@/temporal/workflows'

type Problem = typeof problems.$inferInsert

interface RequestBody {
  title: string
  description: string
  difficulty: Problem['difficulty']
  tags: Problem['tags']
}

export async function POST(request: Request) {
  let body: RequestBody
  try {
    body = (await request.json()) as RequestBody
  } catch (error) {
    return new Response('Invalid JSON body', { status: 400 })
  }

  if (!body.title || !body.description || !body.difficulty || !body.tags) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const problem = await db
    .insert(problems)
    .values({
      title: body.title,
      description: body.description,
      difficulty: body.difficulty,
      tags: body.tags,
    })
    .returning({ id: problems.id })
  const problemId = problem.at(0)?.id

  if (!problemId) {
    return Response.json({ error: 'Failed to create problem' }, { status: 500 })
  }

  await temporalClient.workflow.start<typeof solveProblem>('solveProblem', {
    taskQueue: PROBLEMS_QUEUE_NAME,
    workflowId: problemId,
    args: [problemId, body.description],
  })

  return Response.json({ problemId }, { status: 200 })
}

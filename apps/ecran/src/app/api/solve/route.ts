import { db } from '@/db'
import { problems } from '@/db/schema'
import { getTemporalClient } from '@/temporal/client'
import { PROBLEMS_QUEUE_NAME } from '@/temporal/shared'
import { solveProblem } from '@/temporal/workflows'

type Problem = typeof problems.$inferInsert

export async function POST(request: Request) {
  interface RequestBody {
    problemStatement: string
  }

  let body: RequestBody

  try {
    body = (await request.json()) as RequestBody
  } catch (error) {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { problemStatement } = body

  if (!problemStatement) {
    return new Response('Make sure to send a problem statement', { status: 400 })
  }

  const problem = await db
    .insert(problems)
    .values({
      title: 'Problem',
      description: problemStatement,
      difficulty: 'easy',
      tags: ['array'],
    })
    .returning()
  const problemId = problem.at(0)?.id

  if (!problemId) {
    return new Response('Failed to create problem', { status: 500 })
  }

  await getTemporalClient().workflow.start(solveProblem, {
    taskQueue: PROBLEMS_QUEUE_NAME,
    workflowId: problemId,
    args: [problemId, problemStatement],
  })

  return Response.json({ problemId })
}

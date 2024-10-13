import { db } from '@/db'
import { codeTemplates, problems } from '@/db/schema'
import { eq, sql } from 'drizzle-orm'
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

export async function GET() {
  const dbProblems = await db
    .select({
      id: problems.id,
      title: problems.title,
      description: problems.description,
      difficulty: problems.difficulty,
      tags: problems.tags,
      codeTemplates: sql<{ language: string; starter_code: string }[]>`jsonb_agg(code_templates)`,
    })
    .from(problems)
    .leftJoin(codeTemplates, eq(problems.id, codeTemplates.problemId))
    .groupBy(problems.id)

  const problemsWithCodeTemplates = dbProblems.map((problem) => ({
    ...problem,
    codeTemplates: problem.codeTemplates?.reduce?.((acc, template) => {
      if (template?.language && template?.starter_code) {
        acc[template.language] = template.starter_code;
      }
      return acc;
    }, {} as Record<string, string>) ?? {},
  }));

  return Response.json(problemsWithCodeTemplates, { status: 200 })
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

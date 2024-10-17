import '@anthropic-ai/sdk/shims/node'
import { db } from '@/db'
import { codeTemplates, difficultyEnum, languageEnum, problems, solutions, tagsEnum } from '@/db/schema'
import { SYSTEM_SOLVER_PROMPT } from '@/temporal/prompts/solver'
import { logger } from '@/utils/logger'
import { eq } from 'drizzle-orm'
import { generateObject } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

export async function askClaude(problemStatement: string): Promise<{
  solution: string
  tags: (typeof tagsEnum.enumValues)[number][]
  difficulty: (typeof difficultyEnum.enumValues)[number]
}> {
  logger.info(`Solving problem: ${problemStatement}`)

  const {
    object: { solution, tags, difficulty },
  } = await generateObject({
    model: anthropic('claude-3-5-sonnet-20240620'),
    system: SYSTEM_SOLVER_PROMPT,
    temperature: 0.1,
    schema: z.object({
      solution: z.string(),
      tags: z.array(z.enum(tagsEnum.enumValues)),
      difficulty: z.enum(difficultyEnum.enumValues),
    }),
    prompt: problemStatement,
    maxTokens: 1024,
  })

  return { solution, tags, difficulty }
}

export async function updateProblem(
  problemId: string,
  {
    tags,
    difficulty,
  }: { tags: (typeof tagsEnum.enumValues)[number][]; difficulty: (typeof difficultyEnum.enumValues)[number] },
): Promise<void> {
  logger.info(`Updating problem with id: ${problemId} and tags: ${tags} and difficulty: ${difficulty}`)
  await db.update(problems).set({ tags, difficulty }).where(eq(problems.id, problemId))
}

export async function persistSolution(problemId: string, solution: string): Promise<string> {
  logger.info(`Persisting solution with problemId: ${problemId} and solution: ${solution}`)
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

export async function generateCodeTemplates(
  problemStatement: string,
  problemId: string,
): Promise<{ language: (typeof languageEnum.enumValues)[number]; starterCode: string; problemId: string }[]> {
  logger.info(`Generating code templates for problem: ${problemStatement}`)
  const [problem] = await db.select().from(problems).where(eq(problems.id, problemId))

  if (!problem) {
    throw new Error('Problem not found')
  }

  const templates: { language: (typeof languageEnum.enumValues)[number]; starterCode: string; problemId: string }[] = []
  const languages = Object.values(languageEnum.enumValues)

  for (const language of languages) {
    const {
      object: { starterCode },
    } = await generateObject({
      model: anthropic('claude-3-haiku-20240307'),
      prompt: `Generate starter code template for language: ${language} for the following problem.
Do not include problem statement in the starter code.
Use plain code, not markdown, the output must be a valid code snippet.
The output will be used as a code template, so make sure it is a valid starting point for the problem.
Do not solve the problem, just generate the starter code:

${problemStatement}`,
      schema: z.object({
        starterCode: z.string(),
      }),
    })
    templates.push({ language, starterCode, problemId })
  }

  return templates
}

export async function persistCodeTemplates(
  templates: { language: (typeof languageEnum.enumValues)[number]; starterCode: string; problemId: string }[],
): Promise<string[]> {
  logger.info(`Persisting code templates: ${templates}`)
  const persistedTemplates = await db.insert(codeTemplates).values(templates).returning({ id: codeTemplates.id })
  logger.info(`Persisted code templates: ${persistedTemplates}`)
  return persistedTemplates.map((t) => t.id)
}

import '@anthropic-ai/sdk/shims/node'
import anthropicClient from './anthropic'
import { db } from '@/db'
import { codeTemplates, languageEnum, problems, solutions } from '@/db/schema'
import { SYSTEM_SOLVER_PROMPT } from '@/temporal/prompts/solver'
import { logger } from '@/utils/logger'
import { eq } from 'drizzle-orm'
import { generateObject, generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

export async function askClaude(problemStatement: string): Promise<string> {
  logger.info(`Solving problem: ${problemStatement}`)
  const message = await anthropicClient.messages.create({
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

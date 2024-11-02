import 'highlight.js/styles/github-dark.css'
import { logger } from '@/utils/logger'
import { db } from '@/db'
import { problems, solutions } from '@/db/schema'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { eq } from 'drizzle-orm'
import { validate } from 'uuid'
import { notFound } from 'next/navigation'
import { CreateProblemForm } from '@/components/problem-form'
import { MarkdownContent } from '@/components/markdown-content'
import { cn } from '@/lib/utils'
import { SolveProblemButton } from '@/components/solve-problem-button'
import { SolutionStateProvider } from '@/components/solution-state-provider'
import { SolutionPanel } from '@/components/solution-panel'

export default async function Problem({ params: { id } }: { params: { id: string } }) {
  if (!validate(id) && id !== 'create') {
    notFound()
  }
  logger.info(`Loading problem ${id}`)

  if (id === 'create') {
    return <CreateProblemForm />
  }

  const problemsWithSolutions = await db
    .select()
    .from(problems)
    .leftJoin(solutions, eq(solutions.problemId, problems.id))
    .where(eq(problems.id, id))

  if (problemsWithSolutions.length === 0) {
    notFound()
  }
  const problem = problemsWithSolutions.at(0)?.problems
  const solution = problemsWithSolutions.at(0)?.solutions

  logger.info(`Solution for problem ${problem?.id}`)

  return (
    <SolutionStateProvider>
      <div className="text-base text-zinc-200">
        <div className="flex justify-between items-center mb-5">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink href="/">/</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbLink href="/problems">Problems</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>{problem?.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {problem?.id && <SolveProblemButton problemId={problem.id} />}
        </div>
        <div key={problem?.id} className="flex flex-row space-x-4">
          <div className="basis-1/2 flex-shrink-0 bg-zinc-800 rounded p-4">
            <h2 className="text-2xl font-bold mb-5">{problem?.title}</h2>
            <div className="text-sm flex flex-row gap-4 text-zinc-300 mb-5 text-center">
              <div>
                Difficulty:{' '}
                <span className="bg-zinc-900 text-zinc-200 rounded-full py-0.5 px-2 text-xs">
                  {problem?.difficulty}
                </span>
              </div>
              <div>
                <span>Topics: </span>
                {problem?.tags?.map((tag, index) => (
                  <span
                    key={tag}
                    className={cn('bg-zinc-900 text-zinc-200 rounded-full py-0.5 px-2 text-xs', index > 0 && 'ml-1')}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            {problem?.descriptionHtml ? (
              <MarkdownContent content={problem?.descriptionHtml || ''} html useMDX={false} />
            ) : (
              <MarkdownContent
                content={problem?.description || ''}
                useMDX={false}
                className="whitespace-break-spaces"
              />
            )}
          </div>
          <div className="basis-1/2 prose dark:prose-invert max-w-none overflow-x-auto text-zinc-200">
            {solution?.solution ? (
              <div className="bg-zinc-800 rounded p-4 h-full">
                <MarkdownContent content={solution.solution} />
              </div>
            ) : (
              <SolutionPanel />
            )}
          </div>
        </div>
      </div>
    </SolutionStateProvider>
  )
}

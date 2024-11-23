import 'highlight.js/styles/github-dark.css'
import { logger } from '@/utils/logger'
import { db } from '@/db'
import type { Metadata } from 'next'
import type { ResolvingMetadata } from 'next'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'
import TurndownService from 'turndown'
import { CreateProblemForm } from '@/components/problem-form'
import { MarkdownContent } from '@/components/markdown-content'
import { cn } from '@/lib/utils'
import { SolveProblemButton } from '@/components/solve-problem-button'
import { SolutionStateProvider } from '@/components/solution-state-provider'
import { EmptySolutionPanel } from '@/components/empty-solution-panel'
import { problems, solutions } from '@/db/schema'

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata(props: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const params = await props.params;

  const {
    id
  } = params;

  if (id === 'create') {
    return {
      title: 'Create New Problem',
      description: 'Create a new coding problem and share it with the community',
    }
  }

  const [problemResult] = await db
    .select({
      title: problems.title,
      description: problems.description,
      descriptionHtml: problems.descriptionHtml,
      tags: problems.tags,
    })
    .from(problems)
    .where(eq(problems.titleSlug, id))
    .limit(1)

  if (!problemResult) {
    return {
      title: 'Problem Not Found',
    }
  }

  const previousImages = (await parent).openGraph?.images || []
  const turndownService = new TurndownService()
  let description: string
  if (problemResult.descriptionHtml) {
    description = turndownService.turndown(problemResult.descriptionHtml)
  } else {
    description = problemResult.description
  }

  return {
    title: `${problemResult.title} | Coding Problem`,
    description: description.slice(0, 160),
    keywords: problemResult.tags,
    openGraph: {
      title: `${problemResult.title} | Coding Problem`,
      description: description.slice(0, 160),
      type: 'article',
      tags: problemResult.tags,
      images: [...previousImages],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${problemResult.title} | Coding Problem`,
      description: description.slice(0, 160),
    },
  }
}

export default async function Problem(props: Props) {
  const params = await props.params;

  const {
    id
  } = params;

  if (id === 'create') {
    return <CreateProblemForm />
  }

  logger.info(`Loading problem ${id}`)

  const [result] = await db
    .select({
      problem: problems,
      solution: solutions,
    })
    .from(problems)
    .leftJoin(solutions, eq(solutions.problemId, problems.id))
    .where(eq(problems.titleSlug, id))
    .limit(1)

  if (!result) {
    notFound()
  }

  const { problem, solution } = result
  logger.info(`Solution for problem ${problem.titleSlug}`)

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
                <BreadcrumbPage>{problem.title}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          {problem.id && <SolveProblemButton problemId={problem.id} />}
        </div>
        <div key={problem.titleSlug} className="flex flex-row space-x-4">
          <div className="basis-1/2 flex-shrink-0 bg-zinc-800 rounded p-4">
            <h2 className="text-2xl font-bold mb-5">{problem.title}</h2>
            <div className="text-sm flex flex-row gap-4 text-zinc-300 mb-5 text-center">
              <div>
                Difficulty:{' '}
                <span className="bg-zinc-900 text-zinc-200 rounded-full py-0.5 px-2 text-xs">{problem.difficulty}</span>
              </div>
              <div>
                <span>Topics: </span>
                {problem.tags?.map((tag, index) => (
                  <span
                    key={tag}
                    className={cn('bg-zinc-900 text-zinc-200 rounded-full py-0.5 px-2 text-xs', index > 0 && 'ml-1')}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            {problem.descriptionHtml ? (
              <MarkdownContent content={problem.descriptionHtml} html useMDX={false} />
            ) : (
              <MarkdownContent content={problem.description} useMDX={false} className="whitespace-break-spaces" />
            )}
          </div>
          <div className="basis-1/2 prose dark:prose-invert max-w-none overflow-x-auto text-zinc-200">
            {solution?.solution ? (
              <div className="bg-zinc-800 rounded p-4 h-full">
                <MarkdownContent content={solution.solution} />
              </div>
            ) : (
              <EmptySolutionPanel />
            )}
          </div>
        </div>
      </div>
    </SolutionStateProvider>
  )
}

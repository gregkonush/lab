import { Suspense } from 'react'
import { logger } from '@/utils/logger'
import { db } from '@/db'
import { problems, solutions } from '@/db/schema'
import { Textarea } from '@/components/ui/textarea'
import { createProblem } from './actions'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ComboSelect } from '@/components/combo-select'
import { Button } from '@/components/ui/button'
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
import { RefreshCache } from '@/components/refresh-cache'

export default async function Problem({ params: { id } }: { params: { id: string } }) {
  if (!validate(id) && id !== 'create') {
    notFound()
  }
  logger.info(`Loading problem ${id}`)

  if (id === 'create') {
    return (
      <form action={createProblem} className="space-y-4 min-w-full">
        <Button size="sm">Save</Button>
        <Input name="title" placeholder="Problem Name..." />
        <div className="flex flex-row space-x-4">
          <Select name="difficulty">
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Difficulty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="easy">Easy</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="hard">Hard</SelectItem>
            </SelectContent>
          </Select>
          <ComboSelect />
        </div>
        <Textarea name="description" placeholder="Paste your description here..." className="min-h-96" />
      </form>
    )
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

  return (
    <div>
      <Breadcrumb className="mb-5">
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
      <RefreshCache
        check={async () => {
          'use server'
          return Promise.resolve()
        }}
      />
      <div key={problem?.id} className="flex flex-row divide-x">
        <div className="pr-10 basis-1/2">
          <h2 className="text-2xl font-bold">{problem?.title}</h2>
          <div className="text-sm flex flex-row gap-4 text-zinc-300 mb-1 text-center">
            <div>
              Difficulty:{' '}
              <span className="bg-zinc-800 text-zinc-200 rounded-full py-0.5 px-2 text-xs">{problem?.difficulty}</span>
            </div>
            <div>
              <span>Topics: </span>
              {problem?.tags?.map((tag) => (
                <span key={tag} className="bg-zinc-800 text-zinc-200 rounded-full py-0.5 px-2 text-xs">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="prose dark:prose-invert whitespace-break-spaces prose-sm">{problem?.description}</div>
        </div>
        <div className="pl-10 basis-1/2">
          <h2 className="text-2xl">Solution</h2>
          <Suspense fallback={<div className="bg-red-300 animate-pulse rounded h-64">Loading...</div>}>
            {solution ? (
              <div className="prose dark:prose-invert whitespace-break-spaces prose-sm">{solution?.solution}</div>
            ) : null}
          </Suspense>
        </div>
      </div>
    </div>
  )
}

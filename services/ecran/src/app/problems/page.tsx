import { Suspense } from 'react'
import { DataTable } from './data-table'
import { columns } from './columns'
import { db } from '@/db'
import { problems, codeTemplates } from '@/db/schema'
import { eq, sql, desc } from 'drizzle-orm'
import { z } from 'zod'
import SearchProblems from './search'
import type { Problem } from './types'

const QuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().optional(),
})

interface ProblemsPageProps {
  searchParams: Promise<{
    page?: string
    pageSize?: string
    search?: string
  }>
}

export default async function ProblemsPage(props: ProblemsPageProps) {
  const searchParams = await props.searchParams
  const { page, pageSize, search } = await QuerySchema.parseAsync({
    page: searchParams.page,
    pageSize: searchParams.pageSize,
    search: searchParams.search,
  })

  const offset = (page - 1) * pageSize

  const searchCondition = search
    ? sql`(${problems.title} ILIKE ${`%${search}%`} OR ${problems.description} ILIKE ${`%${search}%`})`
    : sql`1=1`

  const [totalResult, dbProblems] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(problems)
      .where(searchCondition),
    db
      .select({
        id: problems.id,
        title: problems.title,
        titleSlug: problems.titleSlug,
        difficulty: problems.difficulty,
        tags: problems.tags,
        description: problems.description,
        codeTemplates: sql<{ language: string; starter_code: string }[]>`jsonb_agg(code_templates)`,
      })
      .from(problems)
      .leftJoin(codeTemplates, eq(problems.id, codeTemplates.problemId))
      .where(searchCondition)
      .orderBy(desc(problems.id))
      .limit(pageSize)
      .offset(offset)
      .groupBy(problems.id),
  ])

  const total = totalResult[0]?.count ?? 0

  const items = dbProblems.map((problem) => ({
    ...problem,
    codeTemplates:
      problem.codeTemplates?.reduce?.(
        (acc, template) => {
          if (template?.language && template?.starter_code) {
            acc[template.language] = template.starter_code
          }
          return acc
        },
        {} as Record<string, string>,
      ) ?? {},
  }))

  return (
    <div className="container mx-auto">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <SearchProblems defaultValue={search} />
          <div className="flex items-center gap-2">
            <span
              className="rounded-full bg-zinc-100 px-2 py-0.5 text-sm font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
              aria-label="Total number of problems"
            >
              {total}
            </span>
            <h1 className="text-xl font-semibold tracking-tight text-zinc-900/50 dark:text-zinc-50/50">Problems</h1>
          </div>
        </div>
        <Suspense
          fallback={
            <div className="flex h-[400px] items-center justify-center">
              <div
                className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent"
                aria-label="Loading problems"
              >
                <span className="sr-only">Loading problems...</span>
              </div>
            </div>
          }
        >
          <DataTable
            columns={columns}
            data={items as Problem[]}
            pageCount={Math.ceil(total / pageSize)}
            pageSize={pageSize}
            page={page}
          />
        </Suspense>
      </div>
    </div>
  )
}

import { logger } from '@/utils/logger'
import { db } from '@/db'
import { problems } from '@/db/schema'
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

export default async function Problem({ params: { id } }: { params: { id: string } }) {
  logger.info('Loading problem', { id })
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
  const problem = await db.select().from(problems).where(eq(problems.id, id))

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
            <BreadcrumbPage>{problem[0].title}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      {problem.map((p) => (
        <div key={p.id} className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold">{p.title}</h2>
          <div className="text-sm flex flex-row gap-4 text-zinc-300 mb-1 text-center">
            <div>
              Difficulty:{' '}
              <span className="bg-zinc-800 text-zinc-200 rounded-full py-0.5 px-2 text-xs">{p.difficulty}</span>
            </div>
            <div>
              <span>Topics: </span>
              {p.tags?.map((tag) => (
                <span key={tag} className="bg-zinc-800 text-zinc-200 rounded-full py-0.5 px-2 text-xs">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-3 text-sm whitespace-break-spaces">{p.description}</div>
        </div>
      ))}
    </div>
  )
}

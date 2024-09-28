import { Button } from '@/components/ui/button'
import { db } from '@/db'
import { problems } from '@/db/schema'
import Link from 'next/link'
import { DataTable } from './data-table'
import { columns } from './columns'

export const dynamic = 'force-dynamic'

export default async function Problems() {
  const fetchedProblems = await db.select().from(problems)
  return (
    <div className="flex flex-col space-y-4">
      <Link href="/problems/create">
        <Button size="sm">Create</Button>
      </Link>
      <DataTable
        columns={columns}
        data={fetchedProblems.map(({ id, difficulty, title, tags }) => ({ id, difficulty, title, tags: tags ?? [] }))}
      />
    </div>
  )
}

import { logger } from '@/utils/logger'
import { db } from '@/db'
import { problems } from '@/db/schema'
import { eq } from 'drizzle-orm'

export default async function Problem({ params: { id } }: { params: { id: string } }) {
  logger.info('Loading problem', { id })
  const problem = await db.select().from(problems).where(eq(problems.id, id))

  return (
    <div className="prose dark:prose-invert -m-10">
      {problem.map((p) => (
        <div key={p.id} className="flex flex-col gap-2">
          <h2 className="text-2xl font-bold">{p.title}</h2>
          <div className="text-sm text-zinc-400">
            Difficulty: <span className="bg-zinc-800 text-zinc-300 rounded-full py-1 px-2">{p.difficulty}</span>
          </div>
          <p className="text-zinc-300">{p.description}</p>
        </div>
      ))}
    </div>
  )
}

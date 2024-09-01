'use server'

import { problems } from '@/db/schema'
import { db } from '@/db'
import { redirect } from 'next/navigation'
import { InferSelectModel } from 'drizzle-orm'

type Problem = InferSelectModel<typeof problems>

export async function createProblem(data: FormData) {
  const result = await db
    .insert(problems)
    .values({
      title: data.get('title') as string,
      difficulty: data.get('difficulty') as Problem['difficulty'],
      description: data.get('description') as string,
      tags: [data.get('tags')] as Problem['tags'],
    })
    .returning({ insertedId: problems.id })

  if (result.length > 0) {
    redirect(`/problems/${result[0].insertedId}`)
  }
}

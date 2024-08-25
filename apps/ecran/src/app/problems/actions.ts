'use server'

import { problems } from '@/db/schema'
import { db } from '@/db'
import { redirect } from 'next/navigation'

export async function createProblem(data: FormData) {
  const result = await db
    .insert(problems)
    .values({
      title: data.get('title') as string,
      difficulty: data.get('difficulty') as 'easy' | 'medium' | 'hard',
      description: data.get('description') as string,
    })
    .returning({ insertedId: problems.id })

  if (result.length > 0) {
    redirect(`/problems/${result[0].insertedId}`)
  }
}

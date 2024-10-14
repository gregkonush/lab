import { NextResponse } from 'next/server'
import { z } from 'zod'
import { db } from '@/db'
import { feedback, users } from '@/db/schema'
import { logger } from '@/utils/logger'
import { auth } from '@/auth'
import { eq } from 'drizzle-orm'

const feedbackSchema = z.object({
  content: z.string().min(10, 'Feedback must be at least 10 characters long'),
  url: z.string().url(),
})

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { content, url } = feedbackSchema.parse(body)
    const session = await auth()
    let userId = null
    if (session?.user?.email) {
      const [user] = await db.select().from(users).where(eq(users.email, session.user.email))
      userId = user?.id
    }

    const [newFeedback] = await db
      .insert(feedback)
      .values({
        content,
        url,
        userId,
      })
      .returning()

    logger.info('Feedback submitted successfully', { feedbackId: newFeedback?.id, url, userId })

    return NextResponse.json({ message: 'Feedback submitted successfully' }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn(`Invalid feedback submission ${error}`)
      return NextResponse.json({ error: error.errors }, { status: 400 })
    }
    logger.error('Error submitting feedback', { error })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

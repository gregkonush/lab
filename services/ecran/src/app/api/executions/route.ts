import { NextResponse } from 'next/server'
import { execute } from '@/lib/code-executor'
import { auth } from '@/auth'
import { executions, users } from '@/db/schema'
import { db } from '@/db'
import { eq } from 'drizzle-orm'

export async function POST(request: Request) {
  try {
    const userSession = await auth()
    const { code, language } = await request.json()

    if (!language) {
      return NextResponse.json({ error: 'Language is required' }, { status: 400 })
    }

    const outputStream = await execute(code, language)

    let output = ''

    const readableStream = new ReadableStream({
      start(controller) {
        outputStream.on('data', (chunk) => {
          output += chunk.toString()
          controller.enqueue(chunk)
        })
        outputStream.on('end', async () => {
          const [user] = await db
            .select({ id: users.id })
            .from(users)
            .where(eq(users.email, userSession?.user?.email ?? ''))

          try {
            await db.insert(executions).values({
              code,
              output,
              language,
              userId: user?.id ?? null,
            })
          } catch (error) {
            console.error('Failed to save execution:', error)
          }

          controller.close()
        })
        outputStream.on('error', (err) => {
          controller.error(err)
        })
      },
    })

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error: unknown) {
    console.error('Execution error:', error)
    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ error: 'Execution failed' }, { status: 500 })
  }
}

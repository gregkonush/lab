import { NextResponse } from 'next/server'
import { execute } from '@/lib/kubernetes'

export async function POST(request: Request) {
  try {
    const { code, language } = await request.json()
    const outputStream = await execute(code, language)

    return new Response(outputStream as any, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error: any) {
    console.error('Execution error:', error)
    return NextResponse.json({ error: error.message || 'Execution failed' }, { status: 500 })
  }
}

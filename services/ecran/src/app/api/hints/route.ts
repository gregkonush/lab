import { NextResponse } from 'next/server'
import { generateText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { prompt } from './prompt'

export async function POST(request: Request) {
  const { code, problem, language } = await request.json()

  const { text } = await generateText({
    model: anthropic('claude-3-5-sonnet-20240620'),
    system: prompt,
    prompt: `Problem:

    ${problem}
    ----------------------------
    Language: ${language}
    ----------------------------
    Code written by a student so far:

    ${code}`,
    maxTokens: 50,
  })
  return NextResponse.json({ hint: text })
}

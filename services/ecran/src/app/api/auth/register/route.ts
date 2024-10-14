import { type NextRequest, NextResponse } from 'next/server'
import { saltAndHashPassword } from '@/utils/password'
import { db } from '@/db'
import { users } from '@/db/schema'
import { z } from 'zod'
import { logger } from '@/utils/logger'

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(2),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password, name } = registerSchema.parse(body)

    const passwordHash = await saltAndHashPassword(password)

    await db.insert(users).values({
      email,
      name,
      passwordHash,
    })

    return NextResponse.json({ message: 'Registration successful' }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ message: 'Invalid input' }, { status: 400 })
    }

    logger.error('Registration error:', error)

    return NextResponse.json({ message: 'Registration failed' }, { status: 500 })
  }
}

import { type NextRequest, NextResponse } from 'next/server'
import { saltAndHashPassword } from '@/utils/password'
import { db } from '@/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest) {
  const { email, password, name } = await req.json()

  // Validate input (add proper validation as needed)
  if (!email || !password || !name) {
    return NextResponse.json({ message: 'Missing fields' }, { status: 400 })
  }

  // Check if user already exists
  const [existingUser] = await db.select().from(users).where(eq(users.email, email))

  if (existingUser) {
    return NextResponse.json({ message: 'User already exists' }, { status: 400 })
  }

  // Hash the password
  const passwordHash = await saltAndHashPassword(password)

  // Create the user
  await db.insert(users).values({
    email,
    name,
    passwordHash,
  })

  return NextResponse.json({ message: 'User created successfully' }, { status: 201 })
}

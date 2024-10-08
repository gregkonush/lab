import { db } from '@/db'
import { users } from '@/db/schema'
import { eq } from 'drizzle-orm'

export const getUserFromDb = async (email: string, pwHash: string) => {
  const user = await db.select().from(users).where(eq(users.email, email))
}

export const getUserByEmail = async (email: string) => {
  const [user] = await db.select().from(users).where(eq(users.email, email))
  return user || null
}

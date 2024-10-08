import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import dotenv from 'dotenv'

if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: '.env.local' })
}

if (!process.env.DB_URI) {
  throw new Error('DB_URI is not set')
}

const queryClient = postgres(process.env.DB_URI)

export const db = drizzle(queryClient)

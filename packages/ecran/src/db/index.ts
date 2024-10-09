import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import dotenv from 'dotenv'

if (process.env.NODE_ENV !== 'production') {
  dotenv.config({ path: '.env.local' })
}

const queryClient = postgres(process.env.DB_URI!)

export const db = drizzle(queryClient)

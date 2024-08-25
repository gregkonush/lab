import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' })
}

const queryClient = postgres(process.env.DB_URI)

export const db = drizzle(queryClient)

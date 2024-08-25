import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' })
}

async function main() {
  console.log('Connecting to database...')
  const client = postgres(process.env.DB_URI, { max: 1 })

  console.log('Initializing Drizzle...')
  const db = drizzle(client)

  console.log('Running migrations...')
  try {
    await migrate(db, { migrationsFolder: './drizzle' })
    console.log('Migrations completed successfully')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await client.end()
  }

  process.exit(0)
}

main()

import { defineConfig } from 'drizzle-kit'

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env.local' })
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DB_URI!,
  },
})

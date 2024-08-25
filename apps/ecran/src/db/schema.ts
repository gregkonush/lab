import { pgTable, varchar, text, uuid, pgEnum } from 'drizzle-orm/pg-core'

export const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard'])

export const problems = pgTable('problems', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 256 }).notNull(),
  description: text('description').notNull(),
  difficulty: difficultyEnum('difficulty').notNull(),
})

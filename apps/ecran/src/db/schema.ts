import { relations } from 'drizzle-orm'
import { pgTable, varchar, text, uuid, pgEnum, timestamp } from 'drizzle-orm/pg-core'

export const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard'])

export const tags = pgEnum('tags', [
  'array',
  'dynamic-programming',
  'graph',
  'greedy',
  'hash-table',
  'heap',
  'math',
  'number-theory',
  'parsing',
  'simulation',
  'sorting',
  'string',
  'tree',
  'two-pointers',
  'binary-search',
  'divide-and-conquer',
  'depth-first-search',
  'breadth-first-search',
  'union-find',
  'topological-sort',
  'binary-tree',
  'binary-search-tree',
  'segment-tree',
  'binary-indexed-tree',
  'tree-decomposition',
  'trie',
  'djikstra',
  'bellman-ford',
  'floyd-warshall',
  'recursion',
  'sliding-window',
  'linked-list',
  'stack',
  'queue',
  'doubly-linked-list',
  'priority-queue',
  'matrix',
  'bit-manipulation',
])

export const problems = pgTable('problems', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 256 }).notNull(),
  description: text('description').notNull(),
  difficulty: difficultyEnum('difficulty').notNull(),
  tags: tags('tags').array().default([]),
})

export const problemsToSolutions = relations(problems, ({ many }) => ({
  solutions: many(solutions),
}))

export const solutions = pgTable('solutions', {
  id: uuid('id').primaryKey().defaultRandom(),
  problemId: uuid('problem_id')
    .references(() => problems.id)
    .notNull(),
  solution: text('solution').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const solutionsToProblems = relations(solutions, ({ one }) => ({
  problem: one(problems, {
    fields: [solutions.problemId],
    references: [problems.id],
  }),
}))

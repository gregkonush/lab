import { pgTable, varchar, text, uuid, pgEnum } from 'drizzle-orm/pg-core'

export const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard'])

export const tags = pgEnum('tags', [
  'array',
  'binary',
  'bitwise',
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
])

export const problems = pgTable('problems', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 256 }).notNull(),
  description: text('description').notNull(),
  difficulty: difficultyEnum('difficulty').notNull(),
  tags: tags('tags').array().default([]),
})

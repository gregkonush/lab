import { relations } from 'drizzle-orm'
import { pgTable, varchar, text, uuid, pgEnum, timestamp, primaryKey, integer, boolean } from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'

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

export const languageEnum = pgEnum('language', ['python', 'java', 'javascript', 'typescript'])

export const executions = pgTable('executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  output: text('output').notNull(),
  language: languageEnum('language').notNull(),
  executedAt: timestamp('executed_at').defaultNow().notNull(),
  userId: uuid('user_id').references(() => users.id),
})

export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  passwordHash: text('passwordHash').notNull(),
})

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').$type<AdapterAccountType>().notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => ({
    compoundKey: primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  }),
)

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (verificationToken) => ({
    compositePk: primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  }),
)

export const authenticators = pgTable(
  'authenticator',
  {
    credentialID: text('credentialID').notNull().unique(),
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerAccountId: text('providerAccountId').notNull(),
    credentialPublicKey: text('credentialPublicKey').notNull(),
    counter: integer('counter').notNull(),
    credentialDeviceType: text('credentialDeviceType').notNull(),
    credentialBackedUp: boolean('credentialBackedUp').notNull(),
    transports: text('transports'),
  },
  (authenticator) => ({
    compositePK: primaryKey({
      columns: [authenticator.userId, authenticator.credentialID],
    }),
  }),
)

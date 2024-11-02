import { relations } from 'drizzle-orm'
import {
  pgTable,
  varchar,
  text,
  uuid,
  pgEnum,
  timestamp,
  primaryKey,
  integer,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core'
import type { AdapterAccountType } from 'next-auth/adapters'

export const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard'])

export type CodewarsStats = {
  totalAttempts: number
  totalCompleted: number
}

export type LeetcodeStats = {
  acRate: number
  freqBar: number
  likes: number
  dislikes: number
}

export const platformEnum = pgEnum('platform', ['leetcode', 'codewars'])

export const roleEnum = pgEnum('role', ['user', 'admin'])

export const problems = pgTable('problems', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: varchar('title', { length: 256 }).notNull(),
  description: text('description').notNull(),
  descriptionHtml: text('description_html'),
  difficulty: difficultyEnum('difficulty').notNull().default('easy'),
  tags: jsonb('tags').$type<string[]>().default([]),
  titleSlug: varchar('title_slug', { length: 256 }),
  platform: platformEnum('platform').notNull().default('leetcode'),
  stats: jsonb('stats').$type<LeetcodeStats | CodewarsStats>(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
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

export const languageEnum = pgEnum('language', ['python', 'java', 'javascript', 'typescript', 'go', 'rust'])

export const executions = pgTable('executions', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),
  output: text('output').notNull(),
  language: languageEnum('language').notNull(),
  executedAt: timestamp('executed_at').defaultNow().notNull(),
  userId: text('user_id').references(() => users.id),
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
  role: roleEnum('role').notNull().default('user'),
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
      name: 'authenticator_userid_credentialid_pk',
      columns: [authenticator.userId, authenticator.credentialID],
    }),
  }),
)

export const codeTemplates = pgTable('code_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  problemId: uuid('problem_id').references(() => problems.id),
  language: languageEnum('language').notNull(),
  starterCode: text('starter_code').notNull(),
})

export const codeTemplatesToProblems = relations(codeTemplates, ({ one }) => ({
  problem: one(problems, {
    fields: [codeTemplates.problemId],
    references: [problems.id],
  }),
}))

export const problemsRelations = relations(problems, ({ many }) => ({
  solutions: many(solutions),
  codeTemplates: many(codeTemplates),
  hints: many(hints),
}))

export const hints = pgTable('hints', {
  id: uuid('id').primaryKey().defaultRandom(),
  problemId: uuid('problem_id')
    .references(() => problems.id)
    .notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
})

export const hintsToProblems = relations(hints, ({ one }) => ({
  problem: one(problems, {
    fields: [hints.problemId],
    references: [problems.id],
  }),
}))

export const feedback = pgTable('feedback', {
  id: uuid('id').primaryKey().defaultRandom(),
  content: text('content').notNull(),
  url: text('url'),
  userId: text('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const feedbackToUsers = relations(feedback, ({ one }) => ({
  user: one(users, {
    fields: [feedback.userId],
    references: [users.id],
  }),
}))

export const usersRelations = relations(users, ({ many }) => ({
  feedback: many(feedback),
}))

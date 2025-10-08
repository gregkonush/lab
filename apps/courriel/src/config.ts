import { z } from 'zod'

type CsvOptions = {
  field?: string
  minItems?: number
}

const commaSeparatedList = (options: CsvOptions = {}) =>
  z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .refine(
      (items) => items.length >= (options.minItems ?? 0),
      options.field
        ? { message: `${options.field} must include at least ${options.minItems ?? 0} value(s)` }
        : undefined,
    )

const logLevelSchema = z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])

const rawConfigSchema = z.object({
  KAFKA_BROKERS: commaSeparatedList({ field: 'KAFKA_BROKERS', minItems: 1 }),
  KAFKA_CLIENT_ID: z.string().min(1, 'KAFKA_CLIENT_ID is required'),
  KAFKA_GROUP_ID: z.string().min(1, 'KAFKA_GROUP_ID is required'),
  KAFKA_TOPIC: z.string().min(1, 'KAFKA_TOPIC is required'),
  KAFKA_SASL_MECHANISM: z.enum(['scram-sha-512', 'scram-sha-256', 'plain']).default('scram-sha-512'),
  KAFKA_USERNAME: z.string().min(1, 'KAFKA_USERNAME is required'),
  KAFKA_PASSWORD: z.string().min(1, 'KAFKA_PASSWORD is required'),
  KAFKA_USE_SSL: z.coerce.boolean().default(true),
  RESEND_API_KEY: z.string().min(1, 'RESEND_API_KEY is required'),
  RESEND_FROM: z.string().min(1, 'RESEND_FROM is required'),
  RESEND_TO: z
    .string()
    .transform((raw) =>
      raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    )
    .optional()
    .default([]),
  COURIEL_SUBJECT_PREFIX: z.string().optional(),
  COURIEL_LOG_LEVEL: logLevelSchema.default('info'),
})

export const configSchema = rawConfigSchema.transform((value) => ({
  kafka: {
    brokers: value.KAFKA_BROKERS,
    clientId: value.KAFKA_CLIENT_ID,
    groupId: value.KAFKA_GROUP_ID,
    topic: value.KAFKA_TOPIC,
    sasl: {
      mechanism: value.KAFKA_SASL_MECHANISM,
      username: value.KAFKA_USERNAME,
      password: value.KAFKA_PASSWORD,
    },
    ssl: value.KAFKA_USE_SSL,
  },
  resend: {
    apiKey: value.RESEND_API_KEY,
    from: value.RESEND_FROM,
    fallbackRecipients: value.RESEND_TO ?? [],
  },
  email: {
    subjectPrefix: value.COURIEL_SUBJECT_PREFIX ?? null,
  },
  logging: {
    level: value.COURIEL_LOG_LEVEL,
  },
}))

export type AppConfig = z.infer<typeof configSchema>

export const parseConfig = (env: NodeJS.ProcessEnv = process.env): AppConfig => configSchema.parse(env)

let cachedConfig: AppConfig | null = null

export const getConfig = (): AppConfig => {
  if (cachedConfig) {
    return cachedConfig
  }

  cachedConfig = parseConfig()
  return cachedConfig
}

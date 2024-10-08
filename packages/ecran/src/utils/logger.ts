import 'pino-pretty'
import pino from 'pino'
import type { Logger } from 'pino'

export const logger: Logger = pino({
  browser: {
    disabled: true,
  },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
    },
  },
  level: 'info',
})

import winston from 'winston'

const { combine, timestamp, printf, colorize } = winston.format

const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} ${level}: ${message}`
})

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    process.env.NODE_ENV === 'development' ? colorize() : winston.format.uncolorize(),
    logFormat,
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
      consoleWarnLevels: ['warn'],
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      handleExceptions: true,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
    }),
  ],
})

// This ensures logs are properly flushed when app is terminated
process.on('beforeExit', () => {
  logger.end()
})

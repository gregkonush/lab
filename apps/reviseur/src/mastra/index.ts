import { Mastra } from '@mastra/core/mastra'
import { createLogger } from '@mastra/core/logger'
import { githubAgent } from './agents/github.ts'

export const mastra = new Mastra({
  agents: { githubAgent },
  logger: createLogger({
    name: 'Github Agent',
    level: 'debug',
  }),
})

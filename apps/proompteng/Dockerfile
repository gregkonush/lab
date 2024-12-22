FROM node:lts-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml .npmrc ./
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
RUN pnpm install --frozen-lockfile

FROM node:lts-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
RUN pnpm build

FROM node:lts-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/proompteng/.next/standalone /app
COPY --from=builder --chown=nextjs:nodejs /app/apps/proompteng/.next/static /app/apps/proompteng/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/proompteng/public /app/apps/proompteng/public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

WORKDIR /app/apps/proompteng
CMD ["node", "server.js"]

FROM node:lts-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/findbobastore/package.json ./apps/findbobastore/
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
RUN pnpm install --frozen-lockfile

FROM node:lts-alpine AS builder
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/findbobastore/node_modules ./apps/findbobastore/node_modules
COPY . .
RUN --mount=type=secret,id=mapbox_access_token,env=NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN \
  pnpm build:findbobastore

FROM node:lts-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
  adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/findbobastore/.next/standalone /app
COPY --from=builder --chown=nextjs:nodejs /app/apps/findbobastore/.next/static /app/apps/findbobastore/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/findbobastore/public /app/apps/findbobastore/public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

WORKDIR /app/apps/findbobastore
CMD ["node", "server.js"]

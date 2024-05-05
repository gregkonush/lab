FROM node:22-alpine AS base
ENV COREPACK_ALWAYS_CONFIRM=0
FROM base AS deps
WORKDIR /app
COPY . .
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && corepack pnpm install

ENV NODE_ENV production
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

USER  nodejs
EXPOSE 3000
ENV PORT 3000

CMD HOSTNAME="0.0.0.0" corepack pnpm run server

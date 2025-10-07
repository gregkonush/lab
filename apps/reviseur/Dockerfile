FROM node:lts-alpine AS deps

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/run-husky-install.mjs ./scripts/run-husky-install.mjs
COPY apps/reviseur/package.json ./apps/reviseur/
ENV HUSKY=0
RUN corepack enable && pnpm install --frozen-lockfile

FROM node:lts-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/reviseur/node_modules ./apps/reviseur/node_modules
RUN corepack enable
COPY . .
RUN pnpm build:reviseur

FROM node:lts-alpine AS runner
WORKDIR /app

COPY --from=builder /app/apps/reviseur/.mastra/output ./apps/reviseur

WORKDIR /app/apps/reviseur
CMD ["node", "index.mjs"]

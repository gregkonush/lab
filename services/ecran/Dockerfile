FROM node:lts-alpine AS base

# Install pnpm
RUN npm install -g pnpm

FROM base AS deps
WORKDIR /app

# Copy workspace configuration
COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY .npmrc ./

# Copy the service package.json
COPY services/ecran/package.json ./services/ecran/

# Install dependencies
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --no-frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app

# Copy all workspace files
COPY . .
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/services/ecran/node_modules ./services/ecran/node_modules

ENV NEXT_TELEMETRY_DISABLED=1

# Build the project
WORKDIR /app/services/ecran
RUN pnpm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/services/ecran/public ./public
COPY --from=builder /app/services/ecran/.next/standalone ./
COPY --from=builder /app/services/ecran/.next/static ./.next/static

# Set the correct permission for prerender cache
RUN chown -R nextjs:nodejs .next

USER nextjs
EXPOSE 3000
ENV PORT=3000

CMD ["node", "server.js"]

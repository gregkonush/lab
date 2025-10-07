FROM node:lts-alpine AS builder

WORKDIR /repo

# Copy monorepo manifests and scripts so workspace installs can run
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/run-husky-install.mjs ./scripts/run-husky-install.mjs

# Copy the kitty-krew workspace source
COPY apps/kitty-krew ./apps/kitty-krew

# Install dependencies for the kitty-krew workspace using the root pnpm lockfile
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV HUSKY=0
RUN corepack enable pnpm && pnpm install --frozen-lockfile

# Build the application
RUN pnpm --filter ./apps/kitty-krew run build

# Production image
FROM oven/bun:latest

WORKDIR /app/apps/kitty-krew

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV LOG_LEVEL=info

# Copy dependencies and built output
COPY --from=builder /repo/node_modules /app/node_modules
COPY --from=builder /repo/apps/kitty-krew /app/apps/kitty-krew

# Create logs directory and set permissions
RUN mkdir -p logs && chmod 755 logs

# Expose port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "start"]

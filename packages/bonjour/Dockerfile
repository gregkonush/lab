# syntax=docker/dockerfile:1.7

FROM node:22.19.0-bullseye-slim AS builder
ENV PNPM_HOME=/root/.local/share/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /workspace

# Copy workspace manifests required for dependency installation
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY tsconfig.json ./
COPY packages/bonjour/package.json packages/bonjour/package.json
COPY packages/bonjour/tsconfig.json packages/bonjour/tsconfig.json

# Install dependencies scoped to the bonjour package
RUN pnpm install --frozen-lockfile --filter @proompteng/bonjour...

# Copy source files and build outputs
COPY packages/bonjour packages/bonjour
RUN pnpm --filter @proompteng/bonjour build

FROM node:22.19.0-bullseye-slim AS runtime
ENV NODE_ENV=production
WORKDIR /opt/app

# Install only runtime dependencies
COPY packages/bonjour/package.json ./package.json
RUN npm install --omit=dev

# Copy compiled application
COPY --from=builder /workspace/packages/bonjour/dist ./dist

# Drop root privileges for runtime
RUN chown -R node:node /opt/app
USER node

EXPOSE 3000
CMD ["node", "dist/server.js"]

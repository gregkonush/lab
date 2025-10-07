# syntax=docker/dockerfile:1.7
FROM node:22.19.0-slim AS base

WORKDIR /workspace

ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@9.15.2 --activate

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/courriel/package.json ./apps/courriel/package.json

RUN pnpm install --filter courriel... --frozen-lockfile

COPY . .

CMD ["pnpm", "--filter", "courriel", "start"]

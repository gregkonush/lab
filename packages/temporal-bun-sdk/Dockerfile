# syntax=docker/dockerfile:1.6

FROM oven/bun:1.1.20 AS install
WORKDIR /app
COPY packages/temporal-bun-sdk/package.json package.json
COPY packages/temporal-bun-sdk/bunfig.toml bunfig.toml
COPY packages/temporal-bun-sdk/tsconfig.json tsconfig.json
COPY packages/temporal-bun-sdk/src src
COPY packages/temporal-bun-sdk/tests tests
RUN bun install
RUN bun run build

FROM oven/bun:1.1.20 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY packages/temporal-bun-sdk/package.json package.json
COPY packages/temporal-bun-sdk/bunfig.toml bunfig.toml
RUN bun install --production
COPY --from=install /app/dist dist
CMD ["bun", "run", "start:worker"]


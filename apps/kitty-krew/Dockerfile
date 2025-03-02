FROM oven/bun:latest as builder

WORKDIR /app

# Copy package.json and bun.lockb (if available)
COPY package.json ./
COPY bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy application code
COPY . .

# Build the application
RUN bun run vinxi build

# Production image
FROM oven/bun:latest

WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy only necessary files from builder
COPY --from=builder /app/.output ./output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Expose port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "./output/server/index.mjs"]

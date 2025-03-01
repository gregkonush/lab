FROM oven/bun:latest as builder

WORKDIR /app

# Copy package.json and bun.lockb (if available)
COPY package.json ./
COPY bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy application code
COPY . .

# Build the application (uncomment if needed)
# RUN bun run build

# Production image
FROM oven/bun:latest

WORKDIR /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Run the application
CMD ["bun", "run", "start"]

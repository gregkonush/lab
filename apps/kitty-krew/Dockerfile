FROM oven/bun:latest AS builder

WORKDIR /app

RUN echo "Starting build process - builder stage"
RUN echo "Working directory: $(pwd)"

# Copy package.json and bun.lock
RUN echo "Copying package files"
COPY package.json ./
COPY bun.lock ./
RUN echo "Package files copied - contents:"
RUN ls -la

# Install dependencies
RUN echo "Installing dependencies with bun"
RUN bun install --frozen-lockfile
RUN echo "Dependencies installed - node_modules contents:"
RUN ls -la node_modules | head -n 10
RUN echo "Total node_modules count: $(find node_modules -type f | wc -l)"

# Copy application code
RUN echo "Copying application code"
COPY . .
RUN echo "Application code copied - contents:"
RUN ls -la

# Build the application
RUN echo "Building the application"
RUN bun run build
RUN echo "Build completed - output contents:"
RUN ls -la .output || echo ".output directory not found!"
RUN find .output -type d || echo "No .output directories found"

# Production image
FROM oven/bun:latest

WORKDIR /app
RUN echo "Starting production stage"

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Copy only necessary files from builder
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Expose port
EXPOSE 3000

# Run the application
CMD ["bun", "run", "start"]

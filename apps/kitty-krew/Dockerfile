FROM oven/bun:latest AS builder

WORKDIR /app

RUN echo "Starting build process - builder stage"
RUN echo "Working directory: $(pwd)"

# Copy package.json and bun.lockb (if available)
RUN echo "Copying package files"
COPY package.json ./
COPY bun.lockb* ./
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
RUN echo "Directory structure:"
RUN find . -type d -maxdepth 2

# Build the application
RUN echo "Building the application"
RUN bun run build
RUN echo "Build completed - output contents:"
RUN ls -la .output || echo ".output directory not found!"

# Production image
FROM oven/bun:latest

WORKDIR /app
RUN echo "Starting production stage"
RUN echo "Working directory: $(pwd)"

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
RUN echo "Environment variables set: NODE_ENV=${NODE_ENV}, PORT=${PORT}"

# Copy only necessary files from builder
RUN echo "Copying files from builder stage"
COPY --from=builder /app/.output ./output
RUN echo "Output directory copied - contents:"
RUN ls -la ./output || echo "output directory not found!"

COPY --from=builder /app/node_modules ./node_modules
RUN echo "Node modules copied - checking contents:"
RUN ls -la node_modules | head -n 5 || echo "node_modules directory not found!"

COPY --from=builder /app/package.json ./package.json
RUN echo "Package.json copied:"
RUN cat package.json | head -n 10 || echo "package.json not found!"

# Expose port
EXPOSE 3000
RUN echo "Port 3000 exposed"

# Run the application
RUN echo "Ready to start application"
CMD ["bun", "run", "./output/server/index.mjs"]

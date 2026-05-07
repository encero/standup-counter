# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY . .

# Build frontend
RUN npm run build

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++ sqlite

# Copy package files for production deps only
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Remove build dependencies to reduce image size
RUN apk del python3 make g++

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Copy server files
COPY server ./server
COPY tsconfig.json ./

# Copy scripts for CLI tools (team management, seeding, etc.)
COPY scripts ./scripts

# Install tsx for running TypeScript server
RUN npm install -g tsx

# Create data directory for SQLite
RUN mkdir -p /data

# Expose ports
EXPOSE 3001

# Set environment variable for database path
ENV DB_PATH=/data/standup.db

# Start server
CMD ["tsx", "server/index.ts"]

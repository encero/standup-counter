# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# App version (e.g. git short SHA) - baked into the client bundle so it can be
# compared against the server's runtime version. Pass with:
#   docker build --build-arg APP_VERSION=$(git rev-parse --short HEAD) .
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

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

# Same version the client was built with - the server reports it at runtime.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

# Install build dependencies for native modules (better-sqlite3).
# tzdata lets TZ (e.g. Europe/Prague) set the local day used for standup dates
# and sprint rollover; su-exec drops root in the entrypoint.
RUN apk add --no-cache python3 make g++ sqlite tzdata su-exec

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

# tsx (pinned in package.json dependencies) runs the TypeScript server. Link it
# onto PATH so `docker exec <c> tsx scripts/team-cli.ts ...` keeps working.
RUN ln -s /app/node_modules/.bin/tsx /usr/local/bin/tsx \
    && chmod +x /app/scripts/docker-entrypoint.sh

# Create data directory for SQLite, owned by the unprivileged runtime user
RUN mkdir -p /data && chown node:node /data

# Expose ports
EXPOSE 3001

# Set environment variable for database path
ENV DB_PATH=/data/standup.db

# Start server as the unprivileged `node` user (see scripts/docker-entrypoint.sh)
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node_modules/.bin/tsx", "server/index.ts"]

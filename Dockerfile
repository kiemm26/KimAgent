# ================================================================
# KIM-CORE Dockerfile — Multi-stage Node.js 22 Alpine
# ================================================================

# --- Stage 1: Builder ---
FROM node:22-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# --- Stage 2: Production ---
FROM node:22-alpine AS production

RUN apk add --no-cache curl tini

# Create non-root user
RUN addgroup -g 1001 -S kimapp && \
    adduser -S kimapp -u 1001 -G kimapp

WORKDIR /app

# Copy production deps
COPY package.json package-lock.json* ./
RUN npm ci --frozen-lockfile --omit=dev

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY config ./config

# Create data directories
RUN mkdir -p data/db data/media data/backups skills && \
    chown -R kimapp:kimapp /app

USER kimapp

EXPOSE 4000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]

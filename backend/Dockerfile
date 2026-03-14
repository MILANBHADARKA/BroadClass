FROM node:22-slim AS builder

WORKDIR /app/backend

# Install build tools required by mediasoup
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    make \
    g++ \
    gcc \
    linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# ── Runtime stage ──
FROM node:22-slim

WORKDIR /app/backend

# Only install runtime native dependencies for mediasoup
RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/backend .

# Expose ports
EXPOSE 3001 40000-40399/udp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Run migrations then start origin server
CMD ["sh", "-c", "npx prisma migrate deploy && node src/origin/index.js"]

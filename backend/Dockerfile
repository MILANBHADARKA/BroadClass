# Usage:
#   Origin: docker build --build-arg SERVER_TYPE=origin -t broadclass-origin .
#   Edge:   docker build --build-arg SERVER_TYPE=edge -t broadclass-edge .

# Stage 1: Build mediasoup native modules
FROM node:22-slim AS builder

WORKDIR /build

# Install build tools required by mediasoup
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    make \
    g++ \
    gcc \
    linux-libc-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy package files firs
COPY package.json package-lock.json ./

# Install ALL dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate


# Stage 2: Production image for Origin Server
FROM node:22-slim AS origin

WORKDIR /app

# Install only runtime dependencies: FFmpeg for recording
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd -r broadclass && useradd -r -g broadclass broadclass

# Copy built node_modules (includes compiled mediasoup)
COPY --from=builder /build/node_modules ./node_modules

# Copy application source
COPY --from=builder /build/src ./src
COPY --from=builder /build/package.json ./
COPY --from=builder /build/prisma ./prisma
COPY --from=builder /build/prisma.config.ts ./prisma.config.ts

# Copy and setup start script
COPY start.sh ./start.sh
RUN chmod +x ./start.sh

# Set ownership
RUN chown -R broadclass:broadclass /app

# Switch to non-root user
USER broadclass

# Expose ports: HTTP + WebRTC + Recording RTP
EXPOSE 3001 40000-40399/udp 45000-45999/udp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD node -e "fetch('http://localhost:3001/health').then(r=>r.ok||process.exit(1)).catch(()=>process.exit(1))"

# Default environment
ENV NODE_ENV=production \
    ROLE=ORIGIN \
    PORT=3001

CMD ["./start.sh"]


# Stage 3: Production image for Edge Server (lighter, no FFmpeg)
FROM node:22-slim AS edge

WORKDIR /app

# Create non-root user for security
RUN groupadd -r broadclass && useradd -r -g broadclass broadclass

# Copy built node_modules
COPY --from=builder /build/node_modules ./node_modules

# Copy only edge-related source (smaller image)
COPY --from=builder /build/src ./src
COPY --from=builder /build/package.json ./

# Set ownership
RUN chown -R broadclass:broadclass /app

# Switch to non-root user
USER broadclass

# Expose ports: HTTP + WebRTC
EXPOSE 3002 50000-52099/udp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "fetch('http://localhost:3002/health').then(r=>r.ok||process.exit(1)).catch(()=>process.exit(1))"

# Default environment
ENV NODE_ENV=production \
    ROLE=EDGE \
    PORT=3002

CMD ["node", "src/edge/index.js"]

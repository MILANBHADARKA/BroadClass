FROM node:22-slim

WORKDIR /app/backend

# Install build tools required by mediasoup + FFmpeg for recording
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    make \
    g++ \
    gcc \
    linux-libc-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Copy and make start script executable
COPY start.sh /app/backend/start.sh
RUN chmod +x /app/backend/start.sh

# Generate Prisma client
RUN npx prisma generate

# Expose ports (WebRTC + Recording RTP)
EXPOSE 3001 40000-40399/udp 45000-45999/udp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:${PORT:-3001}/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Run migrations then start appropriate server based on ROLE
CMD [ "/app/backend/start.sh" ]

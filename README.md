# BroadClass

**BroadClass** is a scalable, real-time live broadcasting and online classroom platform. It leverages WebRTC for low-latency streaming, an Edge-Origin architecture for handling high volumes of concurrent viewers, and cloud-native integrations for seamless recording and archiving.

[![Docker Hub](https://img.shields.io/badge/Docker%20Hub-Images%20Available-blue?logo=docker)](https://hub.docker.com/u/milanbhadarka)


## Table of Contents

- [Features](#-features)
- [Architecture](#️-architecture)
- [Tech Stack](#-tech-stack)
- [Prerequisites](#-prerequisites)
- [Quick Start](#-quick-start)
  - [Option A: Using Pre-built Docker Images](#option-a-using-pre-built-docker-images-recommended)
  - [Option B: Building from Source](#option-b-building-from-source)
- [Frontend Setup](#-frontend-setup)
- [Configuration](#️-configuration)
- [Recording Pipeline](#-recording-pipeline)
- [Scaling](#-scaling)
- [Troubleshooting](#-troubleshooting)


## Features

- **Real-Time Broadcasting:** Ultra low-latency video and audio streaming using Mediasoup (WebRTC)
- **Scalable Architecture:** Origin-Edge topology that scales horizontally to support thousands of concurrent viewers
- **Role-Based Access Control:** Secure authentication and authorization differentiating between Teachers (Broadcasters) and Students (Viewers)
- **Live Recording & Archiving:** On-the-fly stream interception and trans-muxing via FFmpeg, with direct multipart uploads to AWS S3
- **Recording Access Control:** Teachers can set recording visibility (Private, Classroom)
- **Picture-in-Picture Mode:** Broadcasters can share screen with camera overlay
- **Cloud-Ready:** Containerized with Docker and Docker Compose, utilizing Redis for real-time Pub/Sub coordination
- **Recording Library:** Dedicated panel for instructors to manage, publish, and review past broadcast recordings


## Architecture

The system consists of three primary backend node types alongside a responsive React frontend:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)                  │
│                  WebRTC + Socket.IO Client                  │
└────────────────────────┬────────────────────────────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
      ┌──────────┐  ┌──────────┐  ┌──────────┐
      │  System  │  │  Origin  │  │   Edge   │
      │ Manager  │  │  Server  │  │  Server  │
      │  :3000   │  │  :3001   │  │ :3002-04 │
      └────┬─────┘  └────┬─────┘  └────┬─────┘
           │             │              │
           └─────────────┼──────────────┘
                         ▼
              ┌──────────────────────┐
              │   Redis (Upstash)    │  ← Pub/Sub + Coordination
              └──────────────────────┘
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  ┌──────────┐    ┌──────────┐    ┌──────────┐
  │PostgreSQL│    │   AWS S3 │    │  FFmpeg  │
  │   (RDS)  │    │(Recordings)│   │(Recording)│
  └──────────┘    └──────────┘    └──────────┘
```

### Components:

- **System Manager** (:3000): Handles HTTP APIs, user authentication, role verification, database transactions (Prisma), and triggers cross-service events via Redis Pub/Sub
- **Origin Server** (:3001): Core WebRTC media server. Handles publisher streams and manages stream capture pipeline for recording directly to AWS S3
- **Edge Servers** (:3002-3004): Globally distributable relay nodes that consume from Origin and serve WebRTC streams to viewers, offloading media processing and bandwidth


## Tech Stack

### Frontend
- **React.js** (Vite) - Modern UI framework
- **WebRTC** & Mediasoup Client - Real-time video/audio
- **Socket.IO Client** - Real-time signaling
- **Tailwind CSS v4** - Styling
- **React Router** - Navigation

### Backend
- **Node.js** & Express - Server framework
- **Mediasoup** - WebRTC media server (SFU)
- **Prisma ORM** - Database management
- **Redis** - Pub/Sub & real-time signaling
- **FFmpeg** - Media processing & recording
- **AWS SDK** - S3 for video storage
- **Socket.IO** - Real-time communication

### Infrastructure
- **Docker** & Docker Compose - Containerization
- **PostgreSQL** (AWS RDS) - Database
- **Redis** (Upstash) - Cache & Pub/Sub
- **AWS S3** - Recording storage


## Prerequisites

### Required Services
- **Docker Desktop** ([Download](https://www.docker.com/products/docker-desktop/))
- **PostgreSQL Database** (AWS RDS, Supabase, or local)
- **Redis** (Upstash recommended for cloud, or local)
- **AWS S3 Bucket** (for recordings)
- **Node.js 18+** (for frontend development)

### AWS Setup
1. Create S3 bucket for recordings
2. Create IAM user with S3 write permissions
3. Note down Access Key ID and Secret Access Key

### Upstash Redis Setup
1. Sign up at [Upstash](https://upstash.com)
2. Create new Redis database
3. Copy the Redis URL (starts with `rediss://`)


##  Quick Start

Choose one of two deployment options:

---

### Option A: Using Pre-built Docker Images (Recommended)

**Best for:** Quick deployment, production, testing on multiple machines


#### Step 1: Download Required Files

```bash
# Create deployment directory
mkdir broadclass-deployment
cd broadclass-deployment

Add the following files:
- `docker-compose.hub.yml`
- `.env.example`
From the repository
```

#### Step 2: Configure Environment

```bash
# Copy template to .env
cp .env.example .env

# Edit with your credentials
notepad .env
```

#### Step 3: Pull and Start Services

```bash
# Pull pre-built images from Docker Hub
docker-compose -f docker-compose.hub.yml pull

# Start all services
docker-compose -f docker-compose.hub.yml up -d

# Check status
docker-compose -f docker-compose.hub.yml ps
```

#### Step 4: Verify Services

```bash
# Check health endpoints
http://localhost:3000/health  # System Manager
http://localhost:3001/health  # Origin Server
http://localhost:3002/health  # Edge Server 1
http://localhost:3003/health  # Edge Server 2
http://localhost:3004/health  # Edge Server 3

# All should return: {"status":"healthy"}
```

#### Step 5: View Logs

```bash
# View all logs
docker-compose -f docker-compose.hub.yml logs -f

# View specific service
docker logs broadclass-origin
```

**Proceed to [Frontend Setup](#-frontend-setup)**

---

### Option B: Building from Source

**Best for:** Development, customization, contributing


#### Step 1: Clone Repository

```bash
# Clone the repository
git clone https://github.com/MILANBHADARKA/BroadClass.git
cd BroadClass
```

#### Step 2: Configure Environment

```bash
# Copy template to .env
cp .env.example .env

# Edit with your credentials
notepad .env
```

Fill in the same environment variables as Option A (see above).

#### Step 3: Build Docker Images

```bash
# Build all images
docker-compose build

# Or build specific services
docker-compose build system-manager
docker-compose build origin-server
docker-compose build edge-server-1
```

**What happens:**
- Installs Node.js dependencies
- Compiles Mediasoup native modules
- Installs FFmpeg (Origin only)
- Creates optimized production images
- **System Manager:**
- **Origin Server:**
- **Edge Servers:**

#### Step 4: Start Services

```bash
# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f
```

**Proceed to [Frontend Setup](#-frontend-setup)**


## Frontend Setup

### Step 1: Navigate to Frontend Directory

```bash
cd frontend
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit if needed
notepad .env
```

**Default Frontend Environment:**
```env
VITE_MANAGER_URL=http://localhost:3000
VITE_ORIGIN_URL=http://localhost:3001
```

### Step 4: Start Development Server

```bash
npm run dev
```

**Expected Output:**
```
  VITE v7.3.0  ready in 388 ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.1.x:5173/
```

### Step 5: Access Application

Open your browser and navigate to:
```
http://localhost:5173
```

### Step 6: Create Test Accounts

1. **Register as Teacher:**
   - Click "Register"
   - Select "Teacher" role
   - Fill in credentials
   - Login

2. **Register as Student:**
   - Open incognito/private window
   - Register with "Student" role
   - Login

### Step 7: Test Broadcasting

**As Teacher:**
1. Click "Create Classroom"
2. Fill in classroom details
3. Click "Start Broadcast"
4. Allow camera/microphone permissions
5. Share classroom code with students

**As Student:**
1. Click "Join Classroom"
2. Enter classroom code
3. View live broadcast



## Configuration

### Backend Configuration

All backend services use environment variables from `.env` file:

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection string | `rediss://default:pass@host:6379` |
| `JWT_SECRET` | Secret for JWT token signing | Min 32 characters |
| `INTERNAL_API_KEY` | Key for inter-service auth | Random string |
| `S3_BUCKET` | AWS S3 bucket name | `broadclass-recordings` |
| `S3_REGION` | AWS region | `ap-south-1` |
| `S3_ACCESS_KEY` | AWS access key | `AKIA...` |
| `S3_SECRET_KEY` | AWS secret key | `...` |
| `FRONTEND_ORIGIN` | Frontend URL (CORS) | `http://localhost:5173` |
| `ANNOUNCED_IP` | Public IP for WebRTC | `127.0.0.1` or public IP |
| `LOG_LEVEL` | Logging level | `info`, `debug`, `warn` |

### Frontend Configuration

Frontend uses Vite environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_MANAGER_URL` | System Manager API URL | `http://localhost:3000` |
| `VITE_ORIGIN_URL` | Origin Server URL | `http://localhost:3001` |

---

## Recording Pipeline

BroadClass features a highly optimized recording pipeline:

```
┌──────────────┐
│   Teacher    │
│ Starts Rec.  │
└──────┬───────┘
       │
       ▼
┌──────────────────┐
│ System Manager   │ ← Creates DB record
│ Publishes Event  │ → Redis: recording:start
└──────────────────┘
       │
       ▼
┌──────────────────┐
│  Origin Server   │
│ 1. Creates RTP   │ ← Captures media stream
│    Consumer      │
│ 2. Spawns FFmpeg │ ← Processes video/audio
│ 3. Muxes to WebM │ ← Container format
│ 4. Chunks data   │ ← 2MB segments
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│     AWS S3       │
│ Multipart Upload │ ← Stores recording
└──────────────────┘
```

### Recording Features:
- **Real-time capture** of live broadcasts
- **VP8/Opus codec** (WebM container)
- **Multipart upload** to S3 (resumable)
- **Access control** (Private/Classroom/Public)
- **Download** via presigned URLs
- **FFmpeg optimization** (copy codec, no transcoding)


## Troubleshooting

### Services Not Starting

```bash
# Check logs
docker-compose logs system-manager
docker-compose logs origin-server

# Common issues:
# 1. Wrong DATABASE_URL
# 2. Redis connection failed
# 3. Port already in use
```

### Database Connection Failed

```bash
# Test database connectivity
docker exec broadclass-system-manager node -e "console.log(process.env.DATABASE_URL)"

# Run migrations
docker exec broadclass-origin npx prisma migrate deploy
```

### Redis Connection Failed

```bash
# Verify Redis URL
docker exec broadclass-system-manager node -e "console.log(process.env.REDIS_URL)"

# Check Redis connectivity
docker exec broadclass-system-manager node -e "
const redis = require('redis');
const client = redis.createClient({ url: process.env.REDIS_URL });
client.connect().then(() => console.log('Redis OK')).catch(console.error);
"
```

### Recording Not Working

```bash
# Check Origin logs
docker logs broadclass-origin | grep recording

# Verify S3 credentials
docker exec broadclass-origin node -e "console.log(process.env.S3_ACCESS_KEY)"

# Check FFmpeg is available
docker exec broadclass-origin which ffmpeg
```

### Port Already in Use

```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <process_id> /F

# Linux/Mac
lsof -i :3000
kill -9 <process_id>
```

### WebRTC Connection Failed

1. Check `ANNOUNCED_IP` matches your public IP
2. Ensure UDP ports are open (40000-52399)
3. Check firewall settings
4. Verify frontend can reach backend

### Clean Restart

```bash
# Stop and remove everything
docker-compose down -v

# Remove images (optional)
docker-compose down --rmi all

# Start fresh
docker-compose up -d
```


## Additional Documentation

- [Deployment Guide](./DEPLOYMENT_GUIDE.md) - Detailed deployment instructions
- [Architecture Diagrams](./architecture.dio) - System design diagrams
- [Database Schema](./backend/prisma/schema.prisma) - Database structure

---

**Made with ❤️ by the BroadClass Team**

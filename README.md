# BroadClass

A live classroom platform with low-latency WebRTC streaming and a built-in AI tutor.

Teachers go live, students join from anywhere, and an AI listens to the lecture in real time so students can ask questions and get answers grounded in what the teacher just said with citations back to the exact moment in the transcript. Anything the AI can't confidently answer falls through to the teacher's question queue.


## Table of Contents

- [What it does](#what-it-does)
- [How it's built](#how-its-built)
- [Tech stack](#tech-stack)
- [What you'll need](#what-youll-need)
- [Frontend setup](#frontend-setup)
- [Smart Chat picking your AI providers](#smart-chat--picking-your-ai-providers)
- [Configuration](#configuration)
- [How recording works](#how-recording-works)
- [Scaling notes](#scaling-notes)
- [Troubleshooting](#troubleshooting)


## What it does

### Live classroom
- **Real-time broadcasting** - sub-second video and audio over WebRTC (mediasoup SFU)
- **Edge-Origin architecture** - origin captures the stream, edges fan it out so thousands of viewers can watch without bottlenecking
- **Roles** - teachers create classrooms and broadcast; students join with a 6-character code
- **Picture-in-Picture** - share your screen with your webcam in the corner; the stream keeps updating even if you minimise the browser
- **Recordings** - broadcasts can be recorded to S3 and replayed later, with per-recording access control

### Smart Chat (the AI part)
- **Live transcription** - every lecture is transcribed in real time
- **Cited answers** - students ask a question, the AI searches what's been said so far, and answers with clickable timestamps that jump back to the source
- **Tutor-style replies** - the AI paraphrases and elaborates instead of just quoting; it never contradicts what the teacher actually said
- **Cold-start banner** - at the start of a new lecture there's not enough transcript yet, so questions go straight to the teacher with a friendly explanation
- **Teacher Q&A queue** - questions the AI can't answer (low confidence, no matching transcript) line up for the teacher, sorted by upvotes
- **Each lecture is isolated** - Lecture 2 doesn't pull context from Lecture 1, even in the same classroom
- **Past Lectures** - browse every prior lecture with a read-only transcript + chat replay
- **Pluggable providers** - swap Deepgram, Groq, OpenAI, or Anthropic via env vars; no code changes


## How it's built

There are four backend services and a React frontend:

```
┌──────────────────────────────────────────────────────────┐
│                React Frontend (Vite + Tailwind)          │
└─────────────────────────┬────────────────────────────────┘
                          │
       ┌──────────────────┼──────────────────┬─────────────────┐
       ▼                  ▼                  ▼                 ▼
┌────────────┐    ┌────────────┐    ┌─────────────┐    ┌──────────────┐
│   System   │    │   Origin   │    │    Edge     │    │  AI Service  │
│  Manager   │    │   Server   │    │   Servers   │    │   (FastAPI)  │
│   :3000    │    │   :3001    │    │  :3002-04   │    │    :8080     │
└──────┬─────┘    └──────┬─────┘    └──────┬──────┘    └──────┬───────┘
       │                 │                 │                  │
       └─────────────────┼─────────────────┼──────────────────┘
                         ▼                                    │
              ┌────────────────────┐                          │
              │   Redis (Pub/Sub)  │                          │
              └────────────────────┘                          │
                         │                                    │
         ┌───────────────┼─────────────────┐                  ▼
         ▼               ▼                 ▼          ┌─────────────────┐
   ┌──────────┐   ┌──────────┐      ┌──────────┐     │  External AI    │
   │PostgreSQL│   │  AWS S3  │      │  FFmpeg  │     │  Deepgram, Groq │
   │+pgvector │   │(records) │      │(rec+STT) │     │  OpenAI, Claude │
   └──────────┘   └──────────┘      └──────────┘     └─────────────────┘
```

- **System Manager** (`:3000`) - REST APIs, authentication, classroom management, chat gateway, edge load balancing. Owns the Postgres connection.
- **Origin** (`:3001`) - The mediasoup SFU. Captures the teacher's stream and forks it to FFmpeg for recording and to the AI service for transcription.
- **Edge servers** (`:3002–3004`) - Relay nodes that distribute the stream to students.
- **AI Service** (`:8080`, Python/FastAPI) - Owns the RAG pipeline: transcription, chunking, embeddings, vector search, answering, moderation.

### The Smart Chat data flow
```
 Teacher mic → Origin → FFmpeg PCM → WS → AI Service
                                          │
                                          ├─► Deepgram (transcription)
                                          ├─► Embed each chunk
                                          ▼
                                  Postgres + pgvector
                                  (scoped per lecture)
                                          ▲
                                          │
 Student question → System Manager → AI → search → LLM → answer with citations
                                                   │
                                                   ▼
                                       Live chat fanout via Redis
```


## Tech stack

**Frontend** - React, Vite, Tailwind v4, Socket.IO client, mediasoup-client.

**Node backends** - Express, mediasoup, Socket.IO (Redis adapter), Prisma, FFmpeg, AWS SDK v3.

**Python AI service** - FastAPI, Deepgram SDK, Groq / OpenAI / Anthropic SDKs, sentence-transformers (`all-MiniLM-L6-v2`, 384-d), asyncpg + pgvector.

**Infra** - Docker Compose, PostgreSQL + pgvector, Redis (Upstash works great), AWS S3.


## What you'll need

Before you start:

- **Docker Desktop** ([download](https://www.docker.com/products/docker-desktop/))
- **Node.js 18+** (for running the frontend dev server)
- **PostgreSQL 15+ with `pgvector`** - Supabase and Neon ship it enabled. For self-hosted Postgres install [pgvector](https://github.com/pgvector/pgvector) and run `CREATE EXTENSION IF NOT EXISTS vector;`
- **Redis** - Upstash is the easy cloud option, or run one locally
- **AWS S3 bucket** - needed for recordings; any IAM user with `PutObject` + `GetObject` works
- **At least one AI provider API key** - you only need keys for the providers you actually turn on:

| Provider | When you need it | Get a key |
|---|---|---|
| Deepgram | Live transcription (default) | [console.deepgram.com](https://console.deepgram.com/) |
| Groq | Default LLM + moderation | [console.groq.com](https://console.groq.com/) |
| OpenAI | Optional - answers / embeddings / moderation | [platform.openai.com](https://platform.openai.com/api-keys) |
| Anthropic | Optional - Claude for answers | [console.anthropic.com](https://console.anthropic.com/settings/keys) |

With the defaults, you only need a Deepgram key and a Groq key - both have generous free tiers.


## Frontend setup

```bash
cd frontend
npm install
cp .env.example .env   # defaults are fine for local dev
npm run dev
```

You should see:
```
  VITE v7.x  ready
  ➜  Local:   http://localhost:5173/
```

Open <http://localhost:5173>.

### Try it end-to-end

**As a teacher**
1. Register with role = Teacher
2. Create a classroom (Smart Chat and Live Transcription are on by default)
3. Click **Start Broadcast** and allow camera + microphone
4. Talk for about a minute and a half so the transcript builds up
5. Share the 6-character classroom code

**As a student** (open an incognito window)
1. Register with role = Student, join with the code
2. Ask something about what the teacher just said - the AI replies with a confidence meter and clickable citation chips
3. Ask something the lecture hasn't covered - it routes to the teacher's queue

**Stop the broadcast** - the session shows up in the **Past Lectures** panel with a read-only transcript and chat replay.


## Smart Chat - picking your AI providers

The AI service is built around four interchangeable provider slots. You wire them up with environment variables and restart `ai-service`.

The defaults are:
```env
STT_PROVIDER=deepgram
EMBEDDING_PROVIDER=sentence_transformers   # runs locally, no API key
ANSWER_PROVIDER=groq
MODERATION_PROVIDER=groq
```

### Want to use OpenAI for everything?
```env
EMBEDDING_PROVIDER=openai
ANSWER_PROVIDER=openai
MODERATION_PROVIDER=openai
OPENAI_API_KEY=sk-...
```
(STT stays on Deepgram - OpenAI doesn't have a real-time STT API for our use case.)

### Want Claude for answers but keep Groq for moderation?
```env
ANSWER_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

Then `docker compose restart ai-service` and you're done.

### Why the AI sometimes refuses to answer
On purpose. The pipeline is conservative:
- **Moderation** filters abusive or unsafe questions first.
- **Retrieval gate** - if no transcript chunks match the question well enough, the AI doesn't guess. It routes to the teacher's queue instead.
- **Confidence meter** - every AI reply shows how confident it was, plus clickable citations back to the exact spot in the transcript.

If you'd rather see the AI try harder, you can lower the retrieval threshold in `ai-service/app/config.py` - but expect more hallucinations.


## Configuration

All backend services read from a single root `.env` file. The frontend has its own.

### Backend - core settings

| Variable | What it does | Example |
|---|---|---|
| `DATABASE_URL` | Postgres connection (must have pgvector) | `postgresql://user:pass@host:5432/db` |
| `REDIS_URL` | Redis connection | `rediss://default:pass@host:6379` |
| `JWT_SECRET` | Signs auth tokens (use 32+ random characters) | `<random string>` |
| `INTERNAL_API_KEY` | Auth for inter-service calls | `<random string>` |
| `FRONTEND_ORIGIN` | Your frontend URL, used for CORS | `http://localhost:5173` |
| `NODE_ENV` | `development` or `production` | `development` |
| `DISABLE_RATE_LIMIT` | Skip the API rate limiter in dev | `true` |
| `LOG_LEVEL` | `debug` / `info` / `warn` / `error` | `info` |

### Backend - S3 (recordings)

| Variable | Example |
|---|---|
| `S3_BUCKET` | `broadclass-recordings` |
| `S3_REGION` | `ap-south-1` |
| `S3_ACCESS_KEY` | `AKIA...` |
| `S3_SECRET_KEY` | `...` |
| `S3_PREFIX` | `recordings` (optional) |

### Backend - WebRTC

| Variable | What it does | Example |
|---|---|---|
| `ANNOUNCED_IP` | The IP your edges advertise to viewers | `127.0.0.1` (local) or your public IP |

### Backend - AI Service

| Variable | Default | Notes |
|---|---|---|
| `AI_SERVICE_INTERNAL_URL` | `http://ai-service:8080` | Where System Manager finds the AI service |
| `STT_PROVIDER` | `deepgram` | Only `deepgram` is supported today |
| `EMBEDDING_PROVIDER` | `sentence_transformers` | Or `openai` |
| `ANSWER_PROVIDER` | `groq` | Or `openai` / `anthropic` |
| `MODERATION_PROVIDER` | `groq` | Or `openai` |
| `DEEPGRAM_API_KEY` | - | Needed for default STT |
| `GROQ_API_KEY` | - | Needed for default LLM + moderation |
| `OPENAI_API_KEY` | - | Only if you flip a provider to `openai` |
| `ANTHROPIC_API_KEY` | - | Only if `ANSWER_PROVIDER=anthropic` |

See `.env.example` for the full list including model overrides.

### Frontend

| Variable | Default |
|---|---|
| `VITE_MANAGER_URL` | `http://localhost:3000` |
| `VITE_ORIGIN_URL` | `http://localhost:3001` |


## How recording works

```
Teacher hits "Record"
        │
        ▼
System Manager creates a DB row, publishes recording:start on Redis
        │
        ▼
Origin picks it up, creates an RTP consumer, spawns FFmpeg
FFmpeg muxes the live RTP into a WebM container
        │
        ▼
Chunks are uploaded to S3 as a multipart upload (resumable)
```

A few details worth knowing:
- **VP8/Opus in WebM** - no transcoding, so the Origin host's CPU stays cool
- **Multipart upload** - resumes cleanly if a chunk fails to upload
- **Access control** is per recording (Private or Classroom-only)
- **Downloads** are served via short-lived presigned URLs


## Scaling notes

- **Edges scale horizontally** - start more edge containers, register them with System Manager, and viewers get routed by best-edge logic (geo + load).
- **AI service is stateless** - every request carries its own `sessionId`, so you can add replicas freely.
- **Postgres is the bottleneck for retrieval** when concurrency gets high. Mitigations: PgBouncer / Supavisor, the IVFFLAT index that's already in migrations, and read replicas for retrieval-heavy traffic.
- **Auto-scaling envs** (`AUTO_SCALE_MIN_EDGES`, `AUTO_SCALE_MAX_EDGES`) are available in `.env.example` if you want the manager to spin edges up and down on its own.


## Troubleshooting

### Something won't start
```bash
docker compose logs system-manager
docker compose logs origin-server
docker compose logs ai-service
```
The usual suspects are: wrong `DATABASE_URL`, Redis not reachable, a port already in use, or the `pgvector` extension not installed (AI service will fail loudly on startup).

### "Too many requests" / `Unexpected token 'T'…`
You're getting rate-limited. In `backend/.env` make sure:
```env
NODE_ENV=development
DISABLE_RATE_LIMIT=true
```
…and restart the system manager.

### Database connection failing
```bash
docker exec broadclass-system-manager node -e "console.log(process.env.DATABASE_URL)"
docker exec broadclass-system-manager npx prisma migrate deploy
```

### AI service acting up
```bash
# Which providers is it using?
docker exec broadclass-ai-service env | grep _PROVIDER

# Is the embedding model cached?
docker exec broadclass-ai-service ls /app/hf-cache

# Query the vector store from the CLI
docker exec broadclass-ai-service python scripts/query.py <sessionId> "your question"
```

### Deepgram disconnects mid-broadcast
The AI service sends keep-alives every 5 seconds during silence. If you still see drops, double-check your `DEEPGRAM_API_KEY` quota.

### Recording isn't producing files
```bash
docker logs broadclass-origin | grep -i recording
docker exec broadclass-origin which ffmpeg
docker exec broadclass-origin node -e "console.log(!!process.env.S3_ACCESS_KEY)"
```

### Port already in use
```bash
# Windows
netstat -ano | findstr :3000
taskkill /PID <pid> /F

# Linux / macOS
lsof -i :3000
kill -9 <pid>
```

### WebRTC won't connect
1. `ANNOUNCED_IP` must match an IP your viewers can actually reach (LAN IP for local testing, public IP for production)
2. UDP ports `40000–52399` need to be open
3. VPNs and aggressive firewalls will break things

### Nuclear option
```bash
docker compose down -v
docker compose up -d
docker exec broadclass-system-manager npx prisma migrate deploy
```
---

Made with ❤️ by the BroadClass Team

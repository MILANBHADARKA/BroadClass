# BroadClass

BroadClass is a scalable, real-time live broadcasting and online classroom platform. It leverages WebRTC for low-latency streaming, an Edge-Origin architecture for handling high volumes of concurrent viewers, and cloud-native integrations for seamless recording and archiving.

## 🚀 Features

- **Real-Time Broadcasting:** Ultra low-latency video and audio streaming using Mediasoup (WebRTC).
- **Scalable Architecture:** Origin-Edge topology that scales horizontally to support thousands of concurrent viewers.
- **Role-Based Access Control:** Secure authentication and authorization differentiating between Teachers (Broadcasters) and Viewers.
- **Live Recording & Archiving:** On-the-fly stream interception and trans-muxing via FFmpeg, with direct multipart uploads to AWS S3.
- **Cloud-Ready:** Containerized with Docker and Docker Compose, utilizing Redis for real-time Pub/Sub coordination and scaling.
- **Recording Library:** A dedicated panel for instructors to manage, publish, and review past broadcast recordings.

## 🏗️ Architecture

The system is broken down into three primary backend node types alongside a responsive React frontend:

- **System Manager:** Handles HTTP APIs, user authentication, role verification, database transactions (Prisma), and triggers cross-service events via Redis Pub/Sub.
- **Origin Server:** The core WebRTC media server. It handles publisher streams and manages the stream capture pipeline for recording directly to AWS.
- **Edge Servers:** Globally distributable relay nodes that consume from the Origin server and serve WebRTC streams to end-user viewers, offloading media processing and bandwidth from the Origin.

## 💻 Tech Stack

**Frontend:**
- React.js (Vite)
- WebRTC & Mediasoup Client
- Context API (State & Authentication)

**Backend:**
- Node.js & Express
- Mediasoup (WebRTC Media Server)
- Prisma ORM (Database Management)
- Redis (Pub/Sub & Real-time Signaling)
- FFmpeg (Media processing & chunking)
- AWS SDK (S3 for video storage)

**Infrastructure:**
- Docker & Docker Compose
- AWS (S3 for recordings)

## 🎥 Recording Pipeline Infrastructure

BroadClass features a highly optimized recording pipeline:
1. The **System Manager** receives an authorized recording start request and emits a \
ecording:control\ event via Redis.
2. The **Origin Server** intercepts the live RTP streams using a local Mediasoup consumer.
3. Raw streams are piped into a locally spawned **FFmpeg** process.
4. Video and audio are muxed on-the-fly (\-c copy\) without heavy transcoding.
5. Emitted MP4 chunks are uploaded asynchronously using **AWS S3 Multipart Uploads**.

## 📄 License

This project is licensed under the MIT License.

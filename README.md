# onsh

A modern web application to watch videos synchronously with friends in real-time.

## Features
- Support for **YouTube**, **Rutube**, and **Twitch** (streams & VODs)
- Create a room and invite friends via link
- Synchronized playback (Play, Pause, Seek, Latency Compensation)
- Real-time chat
- Active members list

## Tech Stack
- Frontend: React (Vite), Zustand, Tailwind CSS, YouTube API, Rutube API, Twitch SDK
- Backend: Node.js, Express, Socket.io, Redis

## Prerequisites
- Node.js (tested with v18+)
- Docker & docker-compose (for Redis)

## Getting Started

1. **Start Redis**
   ```bash
   docker-compose up -d
   ```

2. **Start Backend**
   ```bash
   cd backend
   npm install
   npm run dev
   ```
   *The backend will run on http://localhost:3001*

3. **Start Frontend**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   *The frontend will run on http://localhost:5173*

## Usage
1. Open the frontend URL in your browser.
2. Click "Create Room".
3. Enter your nickname.
4. Copy the URL from the browser (or the invite link in the header) and share it with friends.
5. Paste a YouTube URL (e.g., `https://www.youtube.com/watch?v=dQw4w9WgXcQ`) and click "Load".
6. Play, pause, or seek – and it will sync for everyone in the room!

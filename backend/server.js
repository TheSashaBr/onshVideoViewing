const express = require('express');
const http = require('http');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { connectRedis } = require('./src/redis/client');
const roomRoutes = require('./src/routes/rooms');
const { initSocket } = require('./src/socket/index');

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGINS = [
  'https://onsh.vercel.app',
  'https://onsh-video.vercel.app',
  /\.vercel\.app$/,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use('/api/', limiter);
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

app.get('/', (req, res) => {
  res.send('onsh backend service is online');
});

app.use('/api/rooms', roomRoutes);

initSocket(server);

const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await connectRedis();
    console.log('Connected to Redis');
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
  }
}

start();

process.on('SIGTERM', () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

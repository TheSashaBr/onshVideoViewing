const express = require('express');
const http = require('http');
const cors = require('cors');
const { connectRedis } = require('./src/redis/client');
const roomRoutes = require('./src/routes/rooms');
const { initSocket } = require('./src/socket/index');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.json());

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

const { createClient } = require('redis');
const fs = require('fs');
const path = require('path');

// Auto-load .env if present
try {
  const envPath = path.resolve(__dirname, '../../.env');
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const idx = trimmed.indexOf('=');
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        process.env[key] = val;
      }
    });
  }
} catch (e) {}

let rawUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// If user pasted 'redis-cli --tls -u redis://...' or similar string
if (rawUrl.includes('redis://') || rawUrl.includes('rediss://')) {
  const match = rawUrl.match(/rediss?:\/\/[^\s"']+/);
  if (match) {
    rawUrl = match[0];
  }
}

// Upstash requires TLS (rediss:// instead of redis://)
if (rawUrl.includes('upstash.io') && rawUrl.startsWith('redis://')) {
  rawUrl = rawUrl.replace('redis://', 'rediss://');
}

const redisClient = createClient({
  url: rawUrl,
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  }
});

redisClient.on('error', (err) => {
  // Ignore harmless background socket close / reconnect logs if already connected
  if (err.name === 'SocketClosedUnexpectedlyError') {
    return;
  }
  console.log('Redis Client Error:', err.message || err);
});

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
}

module.exports = { redisClient, connectRedis };

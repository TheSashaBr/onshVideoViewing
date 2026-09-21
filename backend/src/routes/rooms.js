const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { createRoom, getRoom } = require('../redis/repository');

const router = express.Router();

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://onshvideowatching-jbxlr1u5.livekit.cloud';

if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  console.warn('[WARN] LIVEKIT_API_KEY / LIVEKIT_API_SECRET are not set — voice chat token issuance will fail.');
}

function base64Url(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function generateLiveKitJwt({ apiKey, apiSecret, identity, name, room, ttlSeconds = 24 * 3600 }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: apiKey,
    sub: String(identity),
    name: name || 'Участник',
    nbf: now - 5,
    exp: now + ttlSeconds,
    video: {
      roomJoin: true,
      room: String(room),
      canPublish: true,
      canSubscribe: true,
    },
  };

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const data = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

async function generateVoiceTokenHandler(req, res) {
  try {
    const roomId = req.params.roomId || req.body.roomId;
    const { userId, nickname } = req.body;

    if (!roomId) {
      return res.status(400).json({ error: 'roomId is required' });
    }
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      return res.status(503).json({ error: 'Voice chat is not configured on this server' });
    }

    const token = generateLiveKitJwt({
      apiKey: LIVEKIT_API_KEY,
      apiSecret: LIVEKIT_API_SECRET,
      identity: String(userId),
      name: nickname || 'Участник',
      room: String(roomId),
    });

    res.json({ token, serverUrl: LIVEKIT_URL });
  } catch (err) {
    console.error('Error generating LiveKit token:', err);
    res.status(500).json({ error: 'Failed to generate voice token' });
  }
}

router.post('/', async (req, res) => {
  try {
    const roomId = uuidv4();
    const hostId = uuidv4(); 
    
    await createRoom(roomId, hostId);
    
    res.json({ roomId, hostToken: hostId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create room' });
  }
});

// Support both /:roomId/voice-token and /voice-token
router.post('/voice-token', generateVoiceTokenHandler);
router.post('/:roomId/voice-token', generateVoiceTokenHandler);

router.get('/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    const room = await getRoom(roomId);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const { hostId: _, ...safeRoom } = room;
    res.json(safeRoom);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch room' });
  }
});

module.exports = router;

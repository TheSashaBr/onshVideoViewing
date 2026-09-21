const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { AccessToken } = require('livekit-server-sdk');
const { createRoom, getRoom } = require('../redis/repository');

const router = express.Router();

const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'APIaRVBdror5c2K';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '0jok3FQxo46YPiKzZvEuejHkfuNGz5H5gK51zbBMHoZ';
const LIVEKIT_URL = process.env.LIVEKIT_URL || 'wss://onshvideowatching-jbxlr1u5.livekit.cloud';

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

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity: String(userId),
      name: nickname || 'Участник',
    });

    at.addGrant({
      roomJoin: true,
      room: String(roomId),
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
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

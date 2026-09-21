const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { createRoom, getRoom } = require('../redis/repository');

const router = express.Router();

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

router.post('/:roomId/voice-token', async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId, nickname } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const { AccessToken } = require('livekit-server-sdk');
    const apiKey = process.env.LIVEKIT_API_KEY || 'APIaRVBdror5c2K';
    const apiSecret = process.env.LIVEKIT_API_SECRET || '0jok3FQxo46YPiKzZvEuejHkfuNGz5H5gK51zbBMHoZ';
    const livekitUrl = process.env.LIVEKIT_URL || 'wss://onshvideowatching-jbxlr1u5.livekit.cloud';

    const at = new AccessToken(apiKey, apiSecret, {
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
    res.json({ token, serverUrl: livekitUrl });
  } catch (err) {
    console.error('Error generating LiveKit token:', err);
    res.status(500).json({ error: 'Failed to generate voice token' });
  }
});

module.exports = router;

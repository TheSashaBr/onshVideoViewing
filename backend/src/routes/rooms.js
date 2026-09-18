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

module.exports = router;

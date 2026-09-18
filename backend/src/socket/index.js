const socketIo = require('socket.io');
const setupHandlers = require('./handlers');

let io;

function initSocket(server) {
  io = socketIo(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    setupHandlers(io, socket);
    
    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });
  
  setInterval(async () => {
    const { getRoom } = require('../redis/repository');
    const rooms = io.sockets.adapter.rooms;
    for (const [roomId, sockets] of rooms.entries()) {
      if (roomId.length === 36) { // uuid length
        const room = await getRoom(roomId);
        if (room) {
          const syncMsg = {
            type: 'SYNC_STATE',
            roomId,
            senderId: 'SERVER',
            timestamp: Date.now(),
            payload: {
              currentTime: parseFloat(room.currentTime),
              isPlaying: room.isPlaying === 'true',
              playbackRate: parseFloat(room.playbackRate)
            }
          };
          io.to(roomId).emit('message', syncMsg);
        }
      }
    }
  }, 8000);

  return io;
}

module.exports = { initSocket };

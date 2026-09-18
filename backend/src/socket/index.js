const socketIo = require('socket.io');
const setupHandlers = require('./handlers');

let io;

function initSocket(server) {
  io = socketIo(server, {
    cors: {
      origin: [
        'https://onsh.vercel.app',
        'https://onsh-video.vercel.app',
        /\.vercel\.app$/,
        'http://localhost:5173',
        'http://localhost:3000',
        'http://127.0.0.1:5173',
      ],
      credentials: true,
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    setupHandlers(io, socket);
  });
  
  return io;
}

module.exports = { initSocket };

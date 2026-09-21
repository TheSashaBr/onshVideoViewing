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
        /^http:\/\/localhost(:\d+)?$/,
        /^http:\/\/127\.0\.0\.1(:\d+)?$/,
        /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
        /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
        /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/,
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

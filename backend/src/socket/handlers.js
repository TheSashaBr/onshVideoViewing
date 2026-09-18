const { getRoom, updateRoomState, addMember, removeMember, getMembers, addChatMessage, getChatMessages } = require('../redis/repository');

function setupHandlers(io, socket) {
  // Simple per-socket message throttle
  let lastMessageTime = 0;
  const MIN_MESSAGE_INTERVAL = 100; // ms
  socket.on('join_room', async ({ roomId, userId, nickname, isHost }) => {
    const room = await getRoom(roomId);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.userId = userId;
    socket.nickname = nickname;

    await addMember(roomId, userId, {
      nickname,
      joinedAt: Date.now(),
      isHost: !!isHost
    });

    const members = await getMembers(roomId);
    
    const msg = {
      type: 'MEMBER_JOINED',
      roomId,
      senderId: userId,
      timestamp: Date.now(),
      payload: {
        nickname,
        members
      }
    };
    io.to(roomId).emit('message', msg);

    // Send current room state and history to the newly connected user
    if (room.videoUrl) {
      socket.emit('message', {
        type: 'LOAD_VIDEO',
        roomId,
        senderId: 'SERVER',
        timestamp: Date.now(),
        payload: {
          videoUrl: room.videoUrl,
          videoType: room.videoType || 'youtube'
        }
      });
    }

    let currentPos = parseFloat(room.currentTime || 0);
    if (room.isPlaying === 'true' && room.lastUpdatedAt) {
      const elapsed = (Date.now() - parseInt(room.lastUpdatedAt, 10)) / 1000;
      currentPos += Math.max(0, elapsed * parseFloat(room.playbackRate || 1.0));
    }

    socket.emit('message', {
      type: 'SYNC_STATE',
      roomId,
      senderId: 'SERVER',
      timestamp: Date.now(),
      payload: {
        currentTime: currentPos,
        isPlaying: room.isPlaying === 'true',
        playbackRate: parseFloat(room.playbackRate || 1.0)
      }
    });

    try {
      const chatHistory = await getChatMessages(roomId);
      socket.emit('chat_history', chatHistory);
    } catch (e) {
      console.error('Error fetching chat history:', e);
    }
  });

  socket.on('message', async (msg) => {
    if (!msg || typeof msg !== 'object' || !msg.type || !msg.roomId) return;
    if (msg.senderId !== socket.userId) return; // Prevent spoofing
    const now_ts = Date.now();
    if (now_ts - lastMessageTime < MIN_MESSAGE_INTERVAL) return;
    lastMessageTime = now_ts;
    const { type, roomId, senderId, timestamp, payload } = msg;
    const broadcast = () => socket.to(roomId).emit('message', msg);
    
    try {
      const now = Date.now();
      
      switch (type) {
        case 'PLAY':
        case 'PAUSE':
        case 'SEEK': {
          let isPlayingState = 'false';
          if (type === 'PLAY') {
            isPlayingState = 'true';
          } else if (type === 'PAUSE') {
            isPlayingState = 'false';
          } else if (type === 'SEEK') {
            isPlayingState = payload.isPlaying !== undefined ? String(payload.isPlaying) : 'true';
          }

          await updateRoomState(roomId, {
            currentTime: payload.position,
            isPlaying: isPlayingState,
            lastUpdatedAt: timestamp,
            lastUpdatedBy: senderId
          });
          broadcast();
          break;
        }
          
        case 'LOAD_VIDEO':
          await updateRoomState(roomId, {
            videoUrl: payload.videoUrl,
            videoType: payload.videoType || 'youtube',
            currentTime: 0,
            isPlaying: 'false',
            lastUpdatedAt: timestamp,
            lastUpdatedBy: senderId
          });
          io.to(roomId).emit('message', msg);
          break;
          
        case 'CHAT_MESSAGE': {
          const text = typeof payload.text === 'string' ? payload.text.slice(0, 500).trim() : '';
          if (!text) break;
          await addChatMessage(roomId, {
            nickname: (payload.nickname || 'Аноним').slice(0, 30),
            text,
            ts: timestamp
          });
          msg = { ...msg, payload: { ...payload, text, nickname: (payload.nickname || 'Аноним').slice(0, 30) } };
          broadcast();
          break;
        }
      }
    } catch (err) {
      console.error('Socket message error:', err);
    }
  });

  socket.on('disconnect', async () => {
    if (socket.roomId && socket.userId) {
      await removeMember(socket.roomId, socket.userId);
      const members = await getMembers(socket.roomId);
      
      const msg = {
        type: 'MEMBER_LEFT',
        roomId: socket.roomId,
        senderId: socket.userId,
        timestamp: Date.now(),
        payload: {
          nickname: socket.nickname || 'User',
          members
        }
      };
      io.to(socket.roomId).emit('message', msg);
    }
  });
}

module.exports = setupHandlers;

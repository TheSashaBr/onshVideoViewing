const {
  getRoom, updateRoomState, addMember, removeMember, getMembers,
  addChatMessage, getChatMessages, addVoiceUser, removeVoiceUser, getVoiceUsers
} = require('../redis/repository');

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
    socket.joinedAt = Date.now();

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

    let currentPos = parseFloat(room.currentTime || 0);
    if (room.isPlaying === 'true' && room.lastUpdatedAt) {
      const elapsed = (Date.now() - parseInt(room.lastUpdatedAt, 10)) / 1000;
      currentPos += Math.max(0, elapsed * parseFloat(room.playbackRate || 1.0));
    }

    // Send current room state and history to the newly connected user
    if (room.videoUrl) {
      socket.emit('message', {
        type: 'LOAD_VIDEO',
        roomId,
        senderId: 'SERVER',
        timestamp: Date.now(),
        payload: {
          videoUrl: room.videoUrl,
          videoType: room.videoType || 'youtube',
          currentTime: currentPos,
          isPlaying: room.isPlaying === 'true',
          playbackRate: parseFloat(room.playbackRate || 1.0)
        }
      });
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

    try {
      const voiceUsers = await getVoiceUsers(roomId);
      socket.emit('webrtc_voice_users_list', { users: voiceUsers });
    } catch (e) {
      console.error('Error fetching voice users on join:', e);
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
          const room = await getRoom(roomId);
          if (!room) return;

          let currentServerPos = parseFloat(room.currentTime || 0);
          if (room.isPlaying === 'true' && room.lastUpdatedAt) {
            const elapsed = (now - parseInt(room.lastUpdatedAt, 10)) / 1000;
            currentServerPos += Math.max(0, elapsed * parseFloat(room.playbackRate || 1.0));
          }

          // GUARD: If the movie is already playing and progress > 3s,
          // ignore auto-startup events (reqPos near 0) from recently joined sockets (< 8s ago)
          const socketAge = now - (socket.joinedAt || 0);
          const reqPos = parseFloat(payload?.position || 0);
          if (socketAge < 8000 && currentServerPos > 3 && reqPos < 2) {
            console.log(`[GUARD] Blocked accidental restart to 0 from newcomer ${socket.userId}`);
            // Resync the newcomer to the current position
            socket.emit('message', {
              type: 'SYNC_STATE',
              roomId,
              senderId: 'SERVER',
              timestamp: now,
              payload: {
                currentTime: currentServerPos,
                isPlaying: room.isPlaying === 'true',
                playbackRate: parseFloat(room.playbackRate || 1.0)
              }
            });
            return;
          }

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
          const text = (payload.text || '').trim().slice(0, 500);
          if (!text) break;
          await addChatMessage(roomId, {
            senderId,
            nickname: (payload.nickname || 'Аноним').slice(0, 30),
            text,
            ts: timestamp
          });
          msg = { ...msg, payload: { ...payload, text, nickname: (payload.nickname || 'Аноним').slice(0, 30) } };
          broadcast();
          break;
        }

        case 'TYPING_STATUS': {
          broadcast();
          break;
        }
      }
    } catch (err) {
      console.error('Socket message error:', err);
    }
  });

  // --- WebRTC Voice Call Signaling ---
  socket.on('webrtc_signal', ({ targetUserId, signal }) => {
    if (!socket.roomId || !socket.userId) return;
    // Relay signaling offer/answer/candidate to specific target peer in the room
    io.to(socket.roomId).emit('webrtc_signal_relay', {
      senderUserId: socket.userId,
      targetUserId,
      signal
    });
  });

  socket.on('webrtc_join_voice', async () => {
    if (!socket.roomId || !socket.userId) return;
    socket.isVoiceActive = true;
    
    try {
      await addVoiceUser(socket.roomId, socket.userId);
      const voiceUsers = await getVoiceUsers(socket.roomId);

      // Broadcast the complete active voice list to EVERYONE in the room
      io.to(socket.roomId).emit('webrtc_voice_users_list', { users: voiceUsers });

      // Notify other peers in room so they can send offers to the newcomer
      socket.to(socket.roomId).emit('webrtc_peer_joined_voice', {
        userId: socket.userId,
        nickname: socket.nickname
      });

      // Return other voice peers to newcomer
      const otherPeers = voiceUsers
        .filter(uid => uid !== socket.userId)
        .map(uid => ({ userId: uid }));
      socket.emit('webrtc_existing_voice_peers', { users: otherPeers });
    } catch (err) {
      console.error('Error in webrtc_join_voice:', err);
    }
  });

  socket.on('webrtc_get_voice_users', async () => {
    if (!socket.roomId) return;
    try {
      const voiceUsers = await getVoiceUsers(socket.roomId);
      socket.emit('webrtc_voice_users_list', { users: voiceUsers });
    } catch (err) {
      console.error('Error in webrtc_get_voice_users:', err);
    }
  });

  socket.on('webrtc_leave_voice', async () => {
    if (!socket.roomId || !socket.userId) return;
    socket.isVoiceActive = false;
    try {
      await removeVoiceUser(socket.roomId, socket.userId);
      const voiceUsers = await getVoiceUsers(socket.roomId);
      io.to(socket.roomId).emit('webrtc_voice_users_list', { users: voiceUsers });
      io.to(socket.roomId).emit('webrtc_peer_left_voice', {
        userId: socket.userId
      });
    } catch (err) {
      console.error('Error in webrtc_leave_voice:', err);
    }
  });

  socket.on('disconnect', async () => {
    if (socket.roomId && socket.userId) {
      if (socket.isVoiceActive) {
        socket.isVoiceActive = false;
        try {
          await removeVoiceUser(socket.roomId, socket.userId);
          const voiceUsers = await getVoiceUsers(socket.roomId);
          io.to(socket.roomId).emit('webrtc_voice_users_list', { users: voiceUsers });
          io.to(socket.roomId).emit('webrtc_peer_left_voice', {
            userId: socket.userId
          });
        } catch (e) {}
      }
      socket.to(socket.roomId).emit('message', {
        type: 'TYPING_STATUS',
        roomId: socket.roomId,
        senderId: socket.userId,
        timestamp: Date.now(),
        payload: {
          nickname: socket.nickname || 'User',
          isTyping: false
        }
      });
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

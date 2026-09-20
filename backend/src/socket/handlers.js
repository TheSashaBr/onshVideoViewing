const {
  getRoom, updateRoomState, addMember, removeMember, getMembers,
  addChatMessage, getChatMessages, addVoiceUser, removeVoiceUser, getVoiceUsers
} = require('../redis/repository');

// Helper to get active members verified against connected Socket.IO sockets
async function getLiveRoomMembers(io, roomId) {
  const socketRoom = io.sockets.adapter.rooms.get(roomId);
  const activeSocketIds = socketRoom ? Array.from(socketRoom) : [];

  const activeSocketsByUserId = new Map();
  for (const sockId of activeSocketIds) {
    const s = io.sockets.sockets.get(sockId);
    if (s && s.userId) {
      activeSocketsByUserId.set(String(s.userId), s);
    }
  }

  const redisMembers = await getMembers(roomId);
  const liveMembers = [];
  const seenUserIds = new Set();

  // Prune any stale members from Redis that have no active socket in the room
  for (const m of redisMembers) {
    const uidStr = String(m.userId);
    if (!activeSocketsByUserId.has(uidStr)) {
      console.log(`[CLEANUP] Pruning stale member ${uidStr} (${m.nickname}) from room ${roomId}`);
      await removeMember(roomId, m.userId).catch(() => {});
    } else {
      if (!seenUserIds.has(uidStr)) {
        seenUserIds.add(uidStr);
        liveMembers.push(m);
      }
    }
  }

  // If there is an active socket whose userId was not in Redis yet, add it
  for (const [uidStr, sock] of activeSocketsByUserId.entries()) {
    if (!seenUserIds.has(uidStr)) {
      const fallbackMember = {
        userId: sock.userId,
        nickname: sock.nickname || 'Участник',
        joinedAt: sock.joinedAt || Date.now(),
        isHost: !!sock.isHost
      };
      await addMember(roomId, sock.userId, fallbackMember).catch(() => {});
      seenUserIds.add(uidStr);
      liveMembers.push(fallbackMember);
    }
  }

  return liveMembers;
}

// Helper to broadcast and return verified active voice participants
async function broadcastVoiceUsers(io, roomId) {
  if (!roomId) return [];
  const socketRoom = io.sockets.adapter.rooms.get(roomId);
  const activeVoiceUserIds = new Set();
  const connectedUserIds = new Set();

  if (socketRoom) {
    for (const sId of socketRoom) {
      const s = io.sockets.sockets.get(sId);
      if (s && s.userId) {
        connectedUserIds.add(String(s.userId));
        if (s.isVoiceActive) {
          activeVoiceUserIds.add(String(s.userId));
        }
      }
    }
  }

  try {
    const redisVoiceUsers = await getVoiceUsers(roomId);
    if (Array.isArray(redisVoiceUsers)) {
      for (const uid of redisVoiceUsers) {
        const uidStr = String(uid);
        if (!connectedUserIds.has(uidStr)) {
          console.log(`[CLEANUP] Pruning dead voice user ${uidStr} from Redis for room ${roomId}`);
          await removeVoiceUser(roomId, uidStr).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.error('[WEBRTC] Error synchronizing voice users with Redis:', err);
  }

  const voiceUsersList = Array.from(activeVoiceUserIds);
  console.log(`[WEBRTC] Room ${roomId} real active voice users (${voiceUsersList.length}):`, voiceUsersList);
  io.to(roomId).emit('webrtc_voice_users_list', { users: voiceUsersList });
  return voiceUsersList;
}

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
    socket.isHost = !!isHost;
    socket.joinedAt = Date.now();

    await addMember(roomId, userId, {
      nickname,
      joinedAt: Date.now(),
      isHost: !!isHost
    });

    const members = await getLiveRoomMembers(io, roomId);
    
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
      await broadcastVoiceUsers(io, roomId);
    } catch (e) {
      console.error('Error broadcasting voice users on join:', e);
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
  socket.on('webrtc_signal', (payload = {}) => {
    const targetRoomId = payload.roomId || socket.roomId;
    const senderUserId = payload.senderUserId || socket.userId;
    const { targetUserId, signal } = payload;
    if (!targetRoomId || !targetUserId || !signal || !senderUserId) return;

    // Direct delivery to target user socket if available
    const socketRoom = io.sockets.adapter.rooms.get(targetRoomId);
    let deliveredDirectly = false;
    if (socketRoom) {
      for (const sId of socketRoom) {
        const s = io.sockets.sockets.get(sId);
        if (s && String(s.userId) === String(targetUserId)) {
          s.emit('webrtc_signal_relay', {
            senderUserId: String(senderUserId),
            targetUserId: String(targetUserId),
            signal
          });
          deliveredDirectly = true;
        }
      }
    }

    // Fallback broadcast to room if socket not found directly
    if (!deliveredDirectly) {
      io.to(targetRoomId).emit('webrtc_signal_relay', {
        senderUserId: String(senderUserId),
        targetUserId: String(targetUserId),
        signal
      });
    }
  });

  socket.on('webrtc_join_voice', async (payload = {}) => {
    const roomId = payload.roomId || socket.roomId;
    const userId = payload.userId || socket.userId;
    const nickname = payload.nickname || socket.nickname;

    if (!roomId || !userId) {
      console.warn(`[WEBRTC] webrtc_join_voice missing roomId (${roomId}) or userId (${userId}) on socket ${socket.id}`);
      return;
    }

    socket.roomId = roomId;
    socket.userId = String(userId);
    if (nickname) socket.nickname = nickname;
    socket.join(roomId);
    socket.isVoiceActive = true;

    try {
      await addVoiceUser(roomId, userId);
    } catch (err) {
      console.error('[WEBRTC] Redis error in addVoiceUser:', err);
    }

    const voiceUsers = await broadcastVoiceUsers(io, roomId);

    // Notify other peers in room so they can send offers to the newcomer
    socket.to(roomId).emit('webrtc_peer_joined_voice', {
      userId: String(userId),
      nickname: socket.nickname || nickname || 'Участник'
    });

    // Return other voice peers to newcomer
    const otherPeers = voiceUsers
      .filter(uid => String(uid) !== String(userId))
      .map(uid => ({ userId: String(uid) }));
    socket.emit('webrtc_existing_voice_peers', { users: otherPeers });
  });

  socket.on('webrtc_get_voice_users', async (payload = {}) => {
    const roomId = payload.roomId || socket.roomId;
    if (!roomId) return;
    socket.roomId = roomId;
    socket.join(roomId);
    await broadcastVoiceUsers(io, roomId);
  });

  socket.on('webrtc_leave_voice', async (payload = {}) => {
    const roomId = payload.roomId || socket.roomId;
    const userId = payload.userId || socket.userId;
    if (!roomId || !userId) return;

    socket.isVoiceActive = false;
    try {
      await removeVoiceUser(roomId, userId);
    } catch (err) {
      console.error('[WEBRTC] Redis error in removeVoiceUser:', err);
    }

    await broadcastVoiceUsers(io, roomId);
    io.to(roomId).emit('webrtc_peer_left_voice', {
      userId: String(userId)
    });
  });

  // Host moderation: Kick participant from room
  socket.on('kick_user', async ({ targetUserId }) => {
    if (!socket.roomId || !socket.isHost || !targetUserId) return;
    if (String(targetUserId) === String(socket.userId)) return; // Cannot kick self

    const socketRoom = io.sockets.adapter.rooms.get(socket.roomId);
    if (socketRoom) {
      for (const sId of Array.from(socketRoom)) {
        const s = io.sockets.sockets.get(sId);
        if (s && String(s.userId) === String(targetUserId)) {
          s.emit('kicked');
          s.leave(socket.roomId);
          if (s.isVoiceActive) {
            s.isVoiceActive = false;
            await removeVoiceUser(socket.roomId, targetUserId).catch(() => {});
            await broadcastVoiceUsers(io, socket.roomId);
            io.to(socket.roomId).emit('webrtc_peer_left_voice', { userId: String(targetUserId) });
          }
        }
      }
    }

    await removeMember(socket.roomId, targetUserId).catch(() => {});
    await removeVoiceUser(socket.roomId, targetUserId).catch(() => {});
    const members = await getLiveRoomMembers(io, socket.roomId);
    io.to(socket.roomId).emit('message', {
      type: 'MEMBER_LEFT',
      roomId: socket.roomId,
      senderId: targetUserId,
      timestamp: Date.now(),
      payload: {
        nickname: 'Участник',
        members
      }
    });

    await broadcastVoiceUsers(io, socket.roomId);
  });

  // Host moderation: Mute participant in voice call
  socket.on('host_mute_user', ({ targetUserId }) => {
    if (!socket.roomId || !socket.isHost || !targetUserId) return;
    const socketRoom = io.sockets.adapter.rooms.get(socket.roomId);
    if (!socketRoom) return;

    for (const sId of Array.from(socketRoom)) {
      const s = io.sockets.sockets.get(sId);
      if (s && String(s.userId) === String(targetUserId)) {
        s.emit('host_muted');
      }
    }
  });

  socket.on('disconnect', async () => {
    if (socket.roomId && socket.userId) {
      // Check if user still has other active sockets in this room (e.g. quick reload, transport upgrade, or another tab)
      const socketRoom = io.sockets.adapter.rooms.get(socket.roomId);
      let userStillConnected = false;
      if (socketRoom) {
        for (const sId of socketRoom) {
          if (sId !== socket.id) {
            const s = io.sockets.sockets.get(sId);
            if (s && String(s.userId) === String(socket.userId)) {
              userStillConnected = true;
              if (socket.isVoiceActive) {
                s.isVoiceActive = true;
              }
              break;
            }
          }
        }
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

      if (!userStillConnected) {
        if (socket.isVoiceActive) {
          socket.isVoiceActive = false;
          try {
            await removeVoiceUser(socket.roomId, socket.userId);
          } catch (e) {}
          await broadcastVoiceUsers(io, socket.roomId);
          io.to(socket.roomId).emit('webrtc_peer_left_voice', {
            userId: String(socket.userId)
          });
        }

        await removeMember(socket.roomId, socket.userId);
        const members = await getLiveRoomMembers(io, socket.roomId);
        
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
    }
  });
}

module.exports = setupHandlers;

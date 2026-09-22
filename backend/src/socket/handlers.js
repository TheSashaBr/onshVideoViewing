const { v4: uuidv4 } = require('uuid');
const {
  getRoom, updateRoomState, addMember, removeMember, getMembers,
  addChatMessage, getChatMessages, addVoiceUser, removeVoiceUser, getVoiceUsers,
  addQueueItem, getQueue, removeQueueItem, popNextQueueItem
} = require('../redis/repository');
const { verifyPassword } = require('../utils/password');

const MAX_QUEUE_SIZE = 50;

// In-memory map to buffer temporary mobile network blips / permission prompts
const pendingDisconnectTimers = new Map(); // key: `${roomId}:${userId}` -> { timer: NodeJS.Timeout, wasVoiceActive: boolean }

// In-memory map tracking a grace period before an absent host's role is handed off
const pendingHostTransferTimers = new Map(); // key: roomId -> { timer: NodeJS.Timeout, hostUserId: string }
const HOST_TRANSFER_GRACE_MS = 3 * 60 * 1000; // 3 minutes

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
    const inGracePeriod = pendingDisconnectTimers.has(`${roomId}:${uidStr}`);
    if (!activeSocketsByUserId.has(uidStr) && !inGracePeriod) {
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
  const activeSocketsByUserId = new Map();

  if (socketRoom) {
    for (const sId of socketRoom) {
      const s = io.sockets.sockets.get(sId);
      if (s && s.userId) {
        activeSocketsByUserId.set(String(s.userId), s);
      }
    }
  }

  // Get current voice users from Redis (source of truth)
  let redisVoiceUsers = [];
  try {
    redisVoiceUsers = await getVoiceUsers(roomId);
  } catch (err) {
    console.error('[WEBRTC] Error getting voice users from Redis:', err);
  }

  const verifiedVoiceUsers = new Set();

  if (Array.isArray(redisVoiceUsers)) {
    for (const uid of redisVoiceUsers) {
      const uidStr = String(uid);
      verifiedVoiceUsers.add(uidStr);
      const sock = activeSocketsByUserId.get(uidStr);
      if (sock) {
        sock.isVoiceActive = true;
      }
    }
  }

  // Also include any connected socket that has isVoiceActive = true but wasn't in Redis yet
  for (const [uidStr, sock] of activeSocketsByUserId.entries()) {
    if (sock.isVoiceActive && !verifiedVoiceUsers.has(uidStr)) {
      verifiedVoiceUsers.add(uidStr);
      await addVoiceUser(roomId, uidStr).catch(() => {});
    }
  }

  const voiceUsersList = Array.from(verifiedVoiceUsers);
  console.log(`[WEBRTC] Room ${roomId} real active voice users (${voiceUsersList.length}):`, voiceUsersList);
  io.to(roomId).emit('webrtc_voice_users_list', { users: voiceUsersList });
  return voiceUsersList;
}

// Hand the host role to the longest-standing remaining member if the current
// host has not reconnected within the grace period. No-op if the host already
// reconnected, the room is gone, or nobody else is left to take over.
async function attemptHostTransfer(io, roomId, absentHostUserId) {
  pendingHostTransferTimers.delete(roomId);
  try {
    const room = await getRoom(roomId);
    if (!room || String(room.hostId) !== String(absentHostUserId)) return;

    const socketRoom = io.sockets.adapter.rooms.get(roomId);
    if (!socketRoom) return;

    for (const sId of socketRoom) {
      const s = io.sockets.sockets.get(sId);
      if (s && String(s.userId) === String(absentHostUserId)) {
        return; // host reconnected in the meantime
      }
    }

    const members = await getMembers(roomId);
    const candidates = members
      .filter(m => String(m.userId) !== String(absentHostUserId))
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
    if (candidates.length === 0) return; // nobody to hand off to

    const newHost = candidates[0];
    await updateRoomState(roomId, { hostId: newHost.userId });
    await addMember(roomId, newHost.userId, { ...newHost, isHost: true });

    for (const sId of socketRoom) {
      const s = io.sockets.sockets.get(sId);
      if (s && String(s.userId) === String(newHost.userId)) {
        s.isHost = true;
      }
    }

    const updatedMembers = await getLiveRoomMembers(io, roomId);
    io.to(roomId).emit('message', {
      type: 'HOST_CHANGED',
      roomId,
      senderId: 'SERVER',
      timestamp: Date.now(),
      payload: {
        newHostId: String(newHost.userId),
        newHostNickname: newHost.nickname,
        members: updatedMembers
      }
    });
    console.log(`[HOST] Transferred host of room ${roomId} to ${newHost.userId} after ${absentHostUserId} was absent for ${HOST_TRANSFER_GRACE_MS / 1000}s`);
  } catch (err) {
    console.error('[HOST] Error transferring host role:', err);
  }
}

function setupHandlers(io, socket) {
  // Simple per-socket message throttle
  let lastMessageTime = 0;
  const MIN_MESSAGE_INTERVAL = 100; // ms
  socket.on('join_room', async ({ roomId, userId, nickname, password }) => {
    const room = await getRoom(roomId);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }

    // Host status is never trusted from the client — it is derived from the
    // hostId assigned server-side at room creation (see routes/rooms.js).
    const verifiedIsHost = !!room.hostId && String(room.hostId) === String(userId);

    // The host never needs the password (they set it); everyone else must
    // supply the correct one before we let them join, verified server-side.
    if (room.passwordHash && !verifiedIsHost && !verifyPassword(password, room.passwordHash)) {
      socket.emit('join_denied', { reason: 'password' });
      return;
    }

    // Cancel a pending host-transfer if the original host reconnected in time
    if (verifiedIsHost && pendingHostTransferTimers.has(roomId)) {
      const pending = pendingHostTransferTimers.get(roomId);
      if (String(pending.hostUserId) === String(userId)) {
        clearTimeout(pending.timer);
        pendingHostTransferTimers.delete(roomId);
      }
    }

    const discKey = `${roomId}:${userId}`;
    if (pendingDisconnectTimers.has(discKey)) {
      const p = pendingDisconnectTimers.get(discKey);
      clearTimeout(p?.timer || p);
      pendingDisconnectTimers.delete(discKey);
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.userId = String(userId);
    socket.nickname = nickname;
    socket.isHost = verifiedIsHost;
    socket.joinedAt = Date.now();

    // Check if user was previously marked in voice in Redis
    try {
      const redisVoice = await getVoiceUsers(roomId);
      if (Array.isArray(redisVoice) && redisVoice.includes(String(userId))) {
        socket.isVoiceActive = true;
      }
    } catch (e) {}

    await addMember(roomId, userId, {
      nickname,
      joinedAt: Date.now(),
      isHost: verifiedIsHost
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

    // Send current room state and history to the newly connected user.
    // senderId carries who actually loaded this video (falls back to 'SERVER'
    // for older rooms) so late joiners know who owns an active local stream.
    if (room.videoUrl) {
      socket.emit('message', {
        type: 'LOAD_VIDEO',
        roomId,
        senderId: room.lastUpdatedBy || 'SERVER',
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
        playbackRate: parseFloat(room.playbackRate || 1.0),
        controlMode: room.controlMode === 'host' ? 'host' : 'anyone',
        isHost: verifiedIsHost
      }
    });

    try {
      const chatHistory = await getChatMessages(roomId);
      socket.emit('chat_history', chatHistory);
    } catch (e) {
      console.error('Error fetching chat history:', e);
    }

    try {
      const queue = await getQueue(roomId);
      socket.emit('message', {
        type: 'QUEUE_STATE',
        roomId,
        senderId: 'SERVER',
        timestamp: Date.now(),
        payload: { queue }
      });
    } catch (e) {
      console.error('Error fetching queue:', e);
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

          // GUARD: In host-only control mode, reject playback commands from
          // non-host sockets and snap the sender back to the real room state.
          if (room.controlMode === 'host' && !socket.isHost) {
            socket.emit('control_denied', { action: type });
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
          
        case 'LOAD_VIDEO': {
          const room = await getRoom(roomId);
          if (!room) return;

          if (room.controlMode === 'host' && !socket.isHost) {
            socket.emit('control_denied', { action: type });
            socket.emit('message', {
              type: 'LOAD_VIDEO',
              roomId,
              senderId: 'SERVER',
              timestamp: now,
              payload: {
                videoUrl: room.videoUrl,
                videoType: room.videoType || 'youtube',
                currentTime: parseFloat(room.currentTime || 0),
                isPlaying: room.isPlaying === 'true',
                playbackRate: parseFloat(room.playbackRate || 1.0)
              }
            });
            return;
          }

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
        }

        case 'QUEUE_ADD': {
          const room = await getRoom(roomId);
          if (!room) return;

          if (room.controlMode === 'host' && !socket.isHost) {
            socket.emit('control_denied', { action: type });
            return;
          }

          const url = (payload?.url || '').trim().slice(0, 500);
          if (!url) return;

          const existingQueue = await getQueue(roomId);
          if (existingQueue.length >= MAX_QUEUE_SIZE) {
            socket.emit('error', 'Очередь переполнена (максимум 50 видео)');
            return;
          }

          await addQueueItem(roomId, {
            id: uuidv4(),
            url,
            videoType: payload?.videoType || 'youtube',
            addedBy: senderId,
            nickname: (payload?.nickname || 'Аноним').slice(0, 30),
            addedAt: timestamp || Date.now()
          });

          const updatedQueue = await getQueue(roomId);
          io.to(roomId).emit('message', {
            type: 'QUEUE_STATE',
            roomId,
            senderId: 'SERVER',
            timestamp: Date.now(),
            payload: { queue: updatedQueue }
          });
          break;
        }

        case 'QUEUE_REMOVE': {
          const room = await getRoom(roomId);
          if (!room) return;

          if (room.controlMode === 'host' && !socket.isHost) {
            socket.emit('control_denied', { action: type });
            return;
          }

          const itemId = payload?.itemId;
          if (!itemId) return;

          const queueBefore = await getQueue(roomId);
          const target = queueBefore.find(item => item.id === itemId);
          if (!target) return;
          // Anyone may remove their own suggestion; only the host may remove others'.
          if (!socket.isHost && String(target.addedBy) !== String(senderId)) return;

          const updatedQueue = await removeQueueItem(roomId, itemId);
          io.to(roomId).emit('message', {
            type: 'QUEUE_STATE',
            roomId,
            senderId: 'SERVER',
            timestamp: Date.now(),
            payload: { queue: updatedQueue }
          });
          break;
        }

        case 'QUEUE_NEXT': {
          const room = await getRoom(roomId);
          if (!room) return;

          if (room.controlMode === 'host' && !socket.isHost) {
            socket.emit('control_denied', { action: type });
            return;
          }

          const nextItem = await popNextQueueItem(roomId);
          if (!nextItem) return;

          await updateRoomState(roomId, {
            videoUrl: nextItem.url,
            videoType: nextItem.videoType || 'youtube',
            currentTime: 0,
            isPlaying: 'false',
            lastUpdatedAt: Date.now(),
            lastUpdatedBy: senderId
          });

          io.to(roomId).emit('message', {
            type: 'LOAD_VIDEO',
            roomId,
            senderId: 'SERVER',
            timestamp: Date.now(),
            payload: {
              videoUrl: nextItem.url,
              videoType: nextItem.videoType || 'youtube',
              currentTime: 0,
              isPlaying: false
            }
          });

          const updatedQueue = await getQueue(roomId);
          io.to(roomId).emit('message', {
            type: 'QUEUE_STATE',
            roomId,
            senderId: 'SERVER',
            timestamp: Date.now(),
            payload: { queue: updatedQueue }
          });
          break;
        }

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

        case 'VIDEO_REACTION': {
          const emoji = (payload?.emoji || '').trim().slice(0, 8);
          if (!emoji) return;
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
          break;
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

    const discKey = `${roomId}:${userId}`;
    if (pendingDisconnectTimers.has(discKey)) {
      const p = pendingDisconnectTimers.get(discKey);
      clearTimeout(p?.timer || p);
      pendingDisconnectTimers.delete(discKey);
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

  // Lightweight voice presence ping (doesn't trigger peer reconnection storms)
  socket.on('webrtc_voice_ping', async (payload = {}) => {
    const roomId = payload.roomId || socket.roomId;
    const userId = payload.userId || socket.userId;
    if (roomId && userId) {
      socket.isVoiceActive = true;
      await addVoiceUser(roomId, userId).catch(() => {});
    }
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

  // Host setting: restrict playback control (play/pause/seek/load) to the host only
  socket.on('set_control_mode', async ({ mode } = {}) => {
    if (!socket.roomId || !socket.isHost) return;
    const validMode = mode === 'host' ? 'host' : 'anyone';
    await updateRoomState(socket.roomId, { controlMode: validMode });
    io.to(socket.roomId).emit('message', {
      type: 'CONTROL_MODE_CHANGED',
      roomId: socket.roomId,
      senderId: socket.userId,
      timestamp: Date.now(),
      payload: { controlMode: validMode }
    });
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
        const dRoomId = socket.roomId;
        const dUserId = String(socket.userId);
        const wasVoiceActive = socket.isVoiceActive;
        const disconnectKey = `${dRoomId}:${dUserId}`;

        // If the departing socket was the verified host, start a grace period
        // before handing the role to another member (see attemptHostTransfer).
        if (socket.isHost && !pendingHostTransferTimers.has(dRoomId)) {
          const hostTimer = setTimeout(() => {
            attemptHostTransfer(io, dRoomId, dUserId);
          }, HOST_TRANSFER_GRACE_MS);
          hostTimer.unref?.(); // background grace timer — must not keep the process alive on its own
          pendingHostTransferTimers.set(dRoomId, { timer: hostTimer, hostUserId: dUserId });
        }

        // Clear any prior timer
        if (pendingDisconnectTimers.has(disconnectKey)) {
          const p = pendingDisconnectTimers.get(disconnectKey);
          clearTimeout(p?.timer || p);
        }

        const timer = setTimeout(async () => {
          pendingDisconnectTimers.delete(disconnectKey);
          // Check if user reconnected in the meantime
          const liveRoom = io.sockets.adapter.rooms.get(dRoomId);
          let reconnected = false;
          if (liveRoom) {
            for (const sId of liveRoom) {
              const s = io.sockets.sockets.get(sId);
              if (s && String(s.userId) === dUserId) {
                reconnected = true;
                break;
              }
            }
          }

          if (!reconnected) {
            if (wasVoiceActive) {
              await removeVoiceUser(dRoomId, dUserId).catch(() => {});
              await broadcastVoiceUsers(io, dRoomId);
              io.to(dRoomId).emit('webrtc_peer_left_voice', {
                userId: dUserId
              });
            }

            await removeMember(dRoomId, dUserId).catch(() => {});
            const members = await getLiveRoomMembers(io, dRoomId);
            const msg = {
              type: 'MEMBER_LEFT',
              roomId: dRoomId,
              senderId: dUserId,
              timestamp: Date.now(),
              payload: {
                nickname: socket.nickname || 'Участник',
                members
              }
            };
            io.to(dRoomId).emit('message', msg);
          }
        }, 15000);
        timer.unref?.(); // background grace timer — must not keep the process alive on its own

        pendingDisconnectTimers.set(disconnectKey, { timer, wasVoiceActive });
      }
    }
  });
}

module.exports = setupHandlers;

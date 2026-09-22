import { create } from 'zustand';
import io from 'socket.io-client';
import { API_URL } from '../utils/api';
import { showToast } from '../components/ToastContainer';
import { useVoiceStore } from './voiceStore';

export const useRoomStore = create((set, get) => ({
  socket: null,
  roomId: null,
  userId: null,
  nickname: '',
  isHost: false,
  roomPassword: '',
  members: [],
  chatMessages: [],
  queue: [], // [{ id, url, videoType, addedBy, nickname, addedAt }]
  typingUsers: {}, // { [userId]: { nickname: string, timeoutId: number } }
  lastRemoteAction: null,
  lastReaction: null, // { emoji, senderId, id, timestamp } — ephemeral, drives the floating reaction animation
  connectionStatus: 'disconnected',
  isJoining: false,
  hasJoinedRoom: false,
  joinError: null, // 'password' when the server rejected join_room for a wrong/missing room password
  roomState: {
    videoUrl: '',
    videoType: 'youtube',
    videoOwnerId: null, // who loaded the current video — used to identify the presenter for videoType 'local-stream'
    currentTime: 0,
    isPlaying: false,
    playbackRate: 1.0,
    controlMode: 'anyone',
    lastUpdatedAt: Date.now()
  },

  joinRoom: (roomId, userId, nickname, isHost, password) => {
    const existingSocket = get().socket;
    if (existingSocket) {
      try {
        existingSocket.disconnect();
      } catch (e) {}
    }

    const socket = io(API_URL, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    });

    set({
      socket,
      roomId,
      userId,
      nickname,
      isHost: !!isHost,
      roomPassword: password || '',
      joinError: null,
      members: [{ userId, nickname, isHost: !!isHost, joinedAt: Date.now() }],
      isJoining: true,
      hasJoinedRoom: false
    });

    // Immediately bind room voice listeners on the socket so no voice events are missed
    useVoiceStore.getState().initVoiceRoomListeners(socket, roomId);

    socket.emit('join_room', { roomId, userId, nickname, isHost, password });

    socket.on('disconnect', (reason) => {
      console.warn('Socket disconnected:', reason);
      set({ connectionStatus: 'disconnected' });
    });

    socket.on('reconnect_attempt', () => {
      set({ connectionStatus: 'reconnecting' });
    });

    socket.on('connect', () => {
      set({ connectionStatus: 'connected' });
      const { roomId: currentRoom, userId: currentUid, nickname: currentNick, isHost: currentHost, roomPassword } = get();
      if (currentRoom && currentUid) {
        socket.emit('join_room', {
          roomId: currentRoom,
          userId: currentUid,
          nickname: currentNick,
          isHost: currentHost,
          password: roomPassword
        });
        // If user is currently in voice, restore voice presence on server
        if (useVoiceStore.getState().isInVoice) {
          socket.emit('webrtc_join_voice', {
            roomId: currentRoom,
            userId: currentUid,
            nickname: currentNick
          });
        } else {
          socket.emit('webrtc_get_voice_users', { roomId: currentRoom });
        }
      }
    });

    socket.on('join_denied', ({ reason } = {}) => {
      set({ isJoining: false, hasJoinedRoom: false, joinError: reason || 'unknown' });
      if (reason === 'password') {
        showToast('Неверный пароль комнаты', 'error', 4000);
      } else {
        showToast('Не удалось войти в комнату', 'error', 4000);
      }
    });

    socket.on('kicked', () => {
      try {
        sessionStorage.removeItem(`onsh_joined_${roomId}`);
        sessionStorage.removeItem(`onsh_guest_uid_${roomId}`);
      } catch (e) {}
      showToast('Вы были исключены из комнаты хостом', 'error', 6000);
      window.location.href = '/';
    });

    socket.on('host_muted', () => {
      window.dispatchEvent(new CustomEvent('onsh_host_muted'));
      showToast('Хост выключил ваш микрофон', 'warning', 4000);
    });

    socket.on('control_denied', ({ action } = {}) => {
      showToast('Управлять воспроизведением может только хост', 'warning', 3500);
    });
    
    socket.on('message', (msg) => {
      // Once any message arrives from room, we are confirmed in room
      set({ isJoining: false, hasJoinedRoom: true });
      const { type, payload, timestamp, senderId } = msg;

      // Track remote playback actions (from peers or server) to command local player
      const isRemote = senderId !== userId || senderId === 'SERVER';
      if (isRemote && ['PLAY', 'PAUSE', 'SEEK', 'SYNC_STATE'].includes(type)) {
        set({ lastRemoteAction: { type, payload, timestamp, id: Math.random() } });
      }

      // Do not ignore system/room state events such as members, sync or typing
      if (senderId === userId && !['SYNC_STATE', 'MEMBER_JOINED', 'MEMBER_LEFT', 'LOAD_VIDEO', 'CONTROL_MODE_CHANGED'].includes(type)) {
        return;
      }
      
      switch (type) {
        case 'MEMBER_JOINED':
        case 'MEMBER_LEFT': {
          const rawMembers = Array.isArray(payload?.members) ? payload.members : [];
          const memberMap = new Map();
          for (const m of rawMembers) {
            if (m && m.userId) {
              memberMap.set(String(m.userId), m);
            }
          }
          // Ensure current user is present in members list
          const { userId: myUid, nickname: myNick, isHost: myIsHost } = get();
          if (myUid && !memberMap.has(String(myUid))) {
            memberMap.set(String(myUid), {
              userId: myUid,
              nickname: myNick || 'Вы',
              isHost: !!myIsHost,
              joinedAt: Date.now()
            });
          }
          const deduplicatedMembers = Array.from(memberMap.values());
          set({ members: deduplicatedMembers });

          if (senderId !== userId && payload?.nickname) {
            if (type === 'MEMBER_JOINED') {
              showToast(`${payload.nickname} вошёл в комнату`, 'success');
            } else {
              showToast(`${payload.nickname} вышел из комнаты`, 'info');
            }
          }
          break;
        }
        case 'CHAT_MESSAGE':
          set(state => {
            const nextTyping = { ...state.typingUsers };
            if (nextTyping[senderId]) {
              clearTimeout(nextTyping[senderId].timeoutId);
              delete nextTyping[senderId];
            }
            return {
              chatMessages: [...state.chatMessages, {
                id: payload.id,
                userId: senderId,
                nickname: payload.nickname,
                text: payload.text,
                replyTo: payload.replyTo || null,
                ts: timestamp || Date.now()
              }].slice(-100),
              typingUsers: nextTyping
            };
          });
          break;
        case 'TYPING_STATUS':
          set(state => {
            const nextTyping = { ...state.typingUsers };
            if (nextTyping[senderId]) {
              clearTimeout(nextTyping[senderId].timeoutId);
              delete nextTyping[senderId];
            }
            if (payload?.isTyping) {
              const timeoutId = setTimeout(() => {
                const current = get().typingUsers;
                if (current[senderId]) {
                  const updated = { ...current };
                  delete updated[senderId];
                  set({ typingUsers: updated });
                }
              }, 4000);
              nextTyping[senderId] = {
                nickname: payload.nickname || 'Кто-то',
                timeoutId
              };
            }
            return { typingUsers: nextTyping };
          });
          break;
        case 'LOAD_VIDEO':
          set(state => ({
            roomState: {
              ...state.roomState,
              videoUrl: payload.videoUrl,
              videoType: payload.videoType || 'youtube',
              videoOwnerId: payload.videoUrl ? senderId : null,
              currentTime: payload.currentTime !== undefined ? payload.currentTime : (payload.videoUrl !== state.roomState.videoUrl ? 0 : state.roomState.currentTime),
              isPlaying: payload.isPlaying !== undefined ? payload.isPlaying : (payload.videoUrl !== state.roomState.videoUrl ? false : state.roomState.isPlaying),
              lastUpdatedAt: timestamp
            }
          }));
          break;
        case 'PLAY':
          set(state => ({
            roomState: { ...state.roomState, currentTime: payload.position, isPlaying: true, lastUpdatedAt: timestamp }
          }));
          break;
        case 'PAUSE':
          set(state => ({
            roomState: { ...state.roomState, currentTime: payload.position, isPlaying: false, lastUpdatedAt: timestamp }
          }));
          break;
        case 'SEEK':
          set(state => ({
            roomState: {
              ...state.roomState,
              currentTime: payload.position,
              isPlaying: payload.isPlaying !== undefined ? payload.isPlaying : state.roomState.isPlaying,
              lastUpdatedAt: timestamp
            }
          }));
          break;
        case 'SYNC_STATE':
          set(state => {
            // The server tells the joining/reconnecting socket its verified host
            // status here; it must never be merged into roomState, and it must
            // never be trusted from anyone but the server.
            const { isHost: verifiedIsHost, ...roomStatePayload } = payload;
            const hostPatch = (senderId === 'SERVER' && typeof verifiedIsHost === 'boolean')
              ? { isHost: verifiedIsHost }
              : {};

            if (state.roomState.isPlaying && (parseFloat(roomStatePayload.currentTime) === 0 || !roomStatePayload.currentTime)) {
              return hostPatch;
            }
            return {
              ...hostPatch,
              roomState: { ...state.roomState, ...roomStatePayload, lastUpdatedAt: timestamp }
            };
          });
          break;
        case 'CONTROL_MODE_CHANGED':
          set(state => ({
            roomState: { ...state.roomState, controlMode: payload?.controlMode === 'host' ? 'host' : 'anyone' }
          }));
          if (senderId !== userId) {
            showToast(
              payload?.controlMode === 'host'
                ? 'Хост включил режим «управляет только хост»'
                : 'Хост разрешил управление всем участникам',
              'info',
              4000
            );
          }
          break;
        case 'QUEUE_STATE':
          set({ queue: Array.isArray(payload?.queue) ? payload.queue : [] });
          break;
        case 'VIDEO_REACTION':
          if (payload?.emoji) {
            set({ lastReaction: { emoji: payload.emoji, senderId, id: Math.random(), timestamp: Date.now() } });
          }
          break;
        case 'HOST_CHANGED': {
          const rawMembers = Array.isArray(payload?.members) ? payload.members : [];
          const memberMap = new Map();
          for (const m of rawMembers) {
            if (m && m.userId) memberMap.set(String(m.userId), m);
          }
          const { userId: myUid } = get();
          const iAmNewHost = !!myUid && String(myUid) === String(payload?.newHostId);
          set({
            members: Array.from(memberMap.values()),
            isHost: iAmNewHost
          });
          showToast(
            iAmNewHost
              ? 'Вы стали хостом комнаты'
              : `${payload?.newHostNickname || 'Другой участник'} теперь хост комнаты`,
            'info',
            5000
          );
          break;
        }
      }
    });

    socket.on('chat_history', (history) => {
      set({ chatMessages: history || [] });
    });
    
    socket.on('error', (err) => {
      console.error('Socket error:', err);
      if (err === 'Room not found' || (typeof err === 'string' && err.includes('Room not found'))) {
        showToast('Комната не найдена или срок её действия истёк', 'error', 5000);
        setTimeout(() => {
          window.location.href = '/';
        }, 1500);
      }
    });
  },
  
  sendMessage: (msgType, payload) => {
    const { socket, roomId, userId } = get();
    if (socket) {
      socket.emit('message', {
        type: msgType,
        roomId,
        senderId: userId,
        timestamp: Date.now(),
        payload
      });
    }

    // Optimistically update local roomState for the sender so calculations never fall back to 0
    if (msgType === 'PLAY') {
      set(state => ({
        roomState: {
          ...state.roomState,
          currentTime: payload?.position ?? state.roomState.currentTime,
          isPlaying: true,
          lastUpdatedAt: Date.now()
        }
      }));
    } else if (msgType === 'PAUSE') {
      set(state => ({
        roomState: {
          ...state.roomState,
          currentTime: payload?.position ?? state.roomState.currentTime,
          isPlaying: false,
          lastUpdatedAt: Date.now()
        }
      }));
    } else if (msgType === 'SEEK') {
      set(state => ({
        roomState: {
          ...state.roomState,
          currentTime: payload?.position ?? state.roomState.currentTime,
          isPlaying: payload?.isPlaying !== undefined ? payload.isPlaying : state.roomState.isPlaying,
          lastUpdatedAt: Date.now()
        }
      }));
    }
  },

  loadVideo: (videoUrl, videoType = 'youtube') => {
    const { sendMessage, userId } = get();
    sendMessage('LOAD_VIDEO', { videoUrl, videoType });
    set(state => ({
      roomState: {
        ...state.roomState,
        videoUrl,
        videoType,
        videoOwnerId: videoUrl ? userId : null,
        currentTime: 0,
        isPlaying: false,
        lastUpdatedAt: Date.now()
      }
    }));
  },
  
  sendChat: (text, replyTo) => {
    const { nickname, userId } = get();
    get().sendMessage('CHAT_MESSAGE', { nickname, text, replyTo: replyTo || null });
    set(state => ({
      chatMessages: [...state.chatMessages, {
        id: `local-${Math.random()}`,
        userId,
        nickname,
        text,
        replyTo: replyTo || null,
        ts: Date.now()
      }].slice(-100)
    }));
  },

  sendTyping: (isTyping) => {
    const { nickname } = get();
    get().sendMessage('TYPING_STATUS', { nickname, isTyping });
  },

  sendReaction: (emoji) => {
    const { userId } = get();
    get().sendMessage('VIDEO_REACTION', { emoji });
    // The server only relays reactions to other sockets, so the sender needs
    // to trigger their own floating animation locally.
    set({ lastReaction: { emoji, senderId: userId, id: Math.random(), timestamp: Date.now() } });
  },

  addToQueue: (url, videoType = 'youtube') => {
    const { nickname } = get();
    get().sendMessage('QUEUE_ADD', { url, videoType, nickname });
  },

  removeFromQueue: (itemId) => {
    get().sendMessage('QUEUE_REMOVE', { itemId });
  },

  playNextFromQueue: () => {
    get().sendMessage('QUEUE_NEXT', {});
  },

  setControlMode: (mode) => {
    const { socket, isHost } = get();
    if (socket && isHost) {
      socket.emit('set_control_mode', { mode: mode === 'host' ? 'host' : 'anyone' });
    }
  },

  kickUser: (targetUserId) => {
    const { socket, isHost } = get();
    if (socket && isHost && targetUserId) {
      socket.emit('kick_user', { targetUserId });
    }
  },

  transferHost: (targetUserId) => {
    const { socket, isHost } = get();
    if (socket && isHost && targetUserId) {
      socket.emit('transfer_host', { targetUserId });
    }
  },

  hostMuteUser: (targetUserId) => {
    const { socket, isHost } = get();
    if (socket && isHost && targetUserId) {
      socket.emit('host_mute_user', { targetUserId });
    }
  },
  
  leaveRoom: () => {
    const { socket, typingUsers } = get();
    if (socket) {
      socket.disconnect();
    }
    Object.values(typingUsers).forEach(t => clearTimeout(t.timeoutId));
    set({
      socket: null,
      roomId: null,
      userId: null,
      nickname: '',
      isHost: false,
      roomPassword: '',
      joinError: null,
      members: [],
      chatMessages: [],
      queue: [],
      typingUsers: {},
      lastRemoteAction: null,
      lastReaction: null,
      isJoining: false,
      hasJoinedRoom: false,
      roomState: {
        videoUrl: '',
        videoType: 'youtube',
        videoOwnerId: null,
        currentTime: 0,
        isPlaying: false,
        playbackRate: 1.0,
        controlMode: 'anyone',
        lastUpdatedAt: Date.now()
      }
    });
  }
}));

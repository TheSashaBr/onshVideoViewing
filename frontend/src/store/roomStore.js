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
  members: [],
  chatMessages: [],
  typingUsers: {}, // { [userId]: { nickname: string, timeoutId: number } }
  lastRemoteAction: null,
  connectionStatus: 'disconnected',
  isJoining: false,
  hasJoinedRoom: false,
  roomState: {
    videoUrl: '',
    videoType: 'youtube',
    currentTime: 0,
    isPlaying: false,
    playbackRate: 1.0,
    lastUpdatedAt: Date.now()
  },
  
  joinRoom: (roomId, userId, nickname, isHost) => {
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
      members: [{ userId, nickname, isHost: !!isHost, joinedAt: Date.now() }],
      isJoining: true,
      hasJoinedRoom: false
    });

    // Immediately bind room voice listeners on the socket so no voice events are missed
    useVoiceStore.getState().initVoiceRoomListeners(socket, roomId);
    
    socket.emit('join_room', { roomId, userId, nickname, isHost });

    socket.on('disconnect', (reason) => {
      console.warn('Socket disconnected:', reason);
      set({ connectionStatus: 'disconnected' });
    });

    socket.on('reconnect_attempt', () => {
      set({ connectionStatus: 'reconnecting' });
    });

    socket.on('connect', () => {
      set({ connectionStatus: 'connected' });
      const { roomId: currentRoom, userId: currentUid, nickname: currentNick, isHost: currentHost } = get();
      if (currentRoom && currentUid) {
        socket.emit('join_room', {
          roomId: currentRoom,
          userId: currentUid,
          nickname: currentNick,
          isHost: currentHost
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
      if (senderId === userId && !['SYNC_STATE', 'MEMBER_JOINED', 'MEMBER_LEFT', 'LOAD_VIDEO'].includes(type)) {
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
                userId: senderId,
                nickname: payload.nickname,
                text: payload.text,
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
            if (state.roomState.isPlaying && (parseFloat(payload.currentTime) === 0 || !payload.currentTime)) {
              return state;
            }
            return {
              roomState: { ...state.roomState, ...payload, lastUpdatedAt: timestamp }
            };
          });
          break;
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
    const { sendMessage } = get();
    sendMessage('LOAD_VIDEO', { videoUrl, videoType });
    set(state => ({
      roomState: {
        ...state.roomState,
        videoUrl,
        videoType,
        currentTime: 0,
        isPlaying: false,
        lastUpdatedAt: Date.now()
      }
    }));
  },
  
  sendChat: (text) => {
    const { nickname, userId } = get();
    get().sendMessage('CHAT_MESSAGE', { nickname, text });
    set(state => ({
      chatMessages: [...state.chatMessages, {
        userId,
        nickname,
        text,
        ts: Date.now()
      }].slice(-100)
    }));
  },

  sendTyping: (isTyping) => {
    const { nickname } = get();
    get().sendMessage('TYPING_STATUS', { nickname, isTyping });
  },

  kickUser: (targetUserId) => {
    const { socket, isHost } = get();
    if (socket && isHost && targetUserId) {
      socket.emit('kick_user', { targetUserId });
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
      members: [],
      chatMessages: [],
      typingUsers: {},
      lastRemoteAction: null,
      isJoining: false,
      hasJoinedRoom: false,
      roomState: {
        videoUrl: '',
        videoType: 'youtube',
        currentTime: 0,
        isPlaying: false,
        playbackRate: 1.0,
        lastUpdatedAt: Date.now()
      }
    });
  }
}));

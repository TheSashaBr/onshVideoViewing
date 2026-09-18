import { create } from 'zustand';
import io from 'socket.io-client';
import { API_URL } from '../utils/api';

export const useRoomStore = create((set, get) => ({
  socket: null,
  roomId: null,
  userId: null,
  nickname: '',
  isHost: false,
  members: [],
  chatMessages: [],
  lastRemoteAction: null,
  connectionStatus: 'disconnected',
  roomState: {
    videoUrl: '',
    videoType: 'youtube',
    currentTime: 0,
    isPlaying: false,
    playbackRate: 1.0,
    lastUpdatedAt: Date.now()
  },
  
  joinRoom: (roomId, userId, nickname, isHost) => {
    const socket = io(API_URL);
    
    set({ socket, roomId, userId, nickname, isHost });
    
    socket.emit('join_room', { roomId, userId, nickname, isHost });

    socket.on('disconnect', (reason) => {
      console.warn('Socket disconnected:', reason);
      set({ connectionStatus: 'disconnected' });
    });

    socket.on('reconnect', () => {
      console.log('Socket reconnected, rejoining room...');
      const { roomId, userId, nickname, isHost } = get();
      socket.emit('join_room', { roomId, userId, nickname, isHost });
      set({ connectionStatus: 'connected' });
    });

    socket.on('reconnect_attempt', () => {
      set({ connectionStatus: 'reconnecting' });
    });

    socket.on('connect', () => {
      set({ connectionStatus: 'connected' });
    });
    
    socket.on('message', (msg) => {
      const { type, payload, timestamp, senderId } = msg;

      // Track remote playback actions (from peers or server) to command local player
      const isRemote = senderId !== userId || senderId === 'SERVER';
      if (isRemote && ['PLAY', 'PAUSE', 'SEEK', 'SYNC_STATE'].includes(type)) {
        set({ lastRemoteAction: { type, payload, timestamp, id: Math.random() } });
      }

      // Do not ignore system/room state events such as members or sync
      if (senderId === userId && !['SYNC_STATE', 'MEMBER_JOINED', 'MEMBER_LEFT', 'LOAD_VIDEO'].includes(type)) {
        return;
      }
      
      switch (type) {
        case 'MEMBER_JOINED':
        case 'MEMBER_LEFT':
          set({ members: payload.members });
          break;
        case 'CHAT_MESSAGE':
          set(state => ({
            chatMessages: [{ nickname: payload.nickname, text: payload.text, ts: timestamp }, ...state.chatMessages].slice(0, 100)
          }));
          break;
        case 'LOAD_VIDEO':
          set(state => ({
            roomState: {
              ...state.roomState,
              videoUrl: payload.videoUrl,
              videoType: payload.videoType || 'youtube',
              currentTime: 0,
              isPlaying: false,
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
    const { nickname } = get();
    get().sendMessage('CHAT_MESSAGE', { nickname, text });
    set(state => ({
      chatMessages: [{ nickname, text, ts: Date.now() }, ...state.chatMessages].slice(0, 100)
    }));
  },
  
  leaveRoom: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
    }
    set({
      socket: null,
      roomId: null,
      userId: null,
      nickname: '',
      isHost: false,
      members: [],
      chatMessages: [],
      lastRemoteAction: null,
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

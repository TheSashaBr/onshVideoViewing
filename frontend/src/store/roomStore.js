import { create } from 'zustand';
import io from 'socket.io-client';

const getApiUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }
  const protocol = window.location.protocol;
  const hostname = window.location.hostname || 'localhost';

  // In production (Vercel / public domain), connect to Render backend by default
  const isLocal =
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('192.168.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('172.');

  if (!isLocal) {
    return 'https://onshvideoviewing.onrender.com';
  }

  return `${protocol}//${hostname}:3001`;
};

const API_URL = getApiUrl();

export const useRoomStore = create((set, get) => ({
  socket: null,
  roomId: null,
  userId: null,
  nickname: '',
  isHost: false,
  members: [],
  chatMessages: [],
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
    
    socket.on('message', (msg) => {
      const { type, payload, timestamp, senderId } = msg;
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
        case 'SEEK':
          set(state => ({
            roomState: { ...state.roomState, currentTime: payload.position, isPlaying: false, lastUpdatedAt: timestamp }
          }));
          break;
        case 'SYNC_STATE':
          set(state => ({
            roomState: { ...state.roomState, ...payload, lastUpdatedAt: timestamp }
          }));
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
    set({ socket: null, roomId: null, members: [], chatMessages: [] });
  }
}));

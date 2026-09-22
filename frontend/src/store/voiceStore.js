import { create } from 'zustand';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useRoomStore } from './roomStore';
import { showToast } from '../components/ToastContainer';
import { API_URL } from '../utils/api';
const LIVEKIT_DEFAULT_URL = 'wss://onshvideowatching-jbxlr1u5.livekit.cloud';

export const useVoiceStore = create((set, get) => ({
  isInVoice: false,
  isMuted: false,
  isConnecting: false,
  audioBlocked: false, // browser autoplay policy requires user interaction
  peerConnectionStates: {}, // { [userId]: 'connecting' | 'connected' | 'failed' }
  roomVoiceUsers: new Set(), // Set of all userIds currently in voice in this room
  activeSpeakers: new Set(), // Set of userIds with active connections
  talkingUsers: new Set(), // Set of userIds currently speaking
  error: null,

  livekitRoom: null,
  remoteAudioElements: {},
  voiceHeartbeatInterval: null,

  // Unlock audio playback if browser autoplay blocked it
  unlockAudioPlayback: async () => {
    let anySuccess = false;
    for (const audio of Object.values(get().remoteAudioElements)) {
      if (audio && audio.paused) {
        try {
          await audio.play();
          anySuccess = true;
        } catch (e) {}
      }
    }
    const lk = get().livekitRoom;
    if (lk && lk.startAudio) {
      await lk.startAudio().catch(() => {});
      anySuccess = true;
    }
    set({ audioBlocked: false });
    if (anySuccess) {
      showToast('Звук в голосовом чате включен', 'success', 2500);
    }
  },

  retryPeerConnection: async (peerId) => {
    const lk = get().livekitRoom;
    if (lk) {
      set(prev => ({
        peerConnectionStates: { ...prev.peerConnectionStates, [String(peerId)]: 'connected' }
      }));
    }
  },

  initVoiceRoomListeners: (socket, roomId) => {
    if (!socket) return;
    const currentRoomId = roomId || useRoomStore.getState().roomId;

    socket.off('webrtc_voice_users_list');
    socket.off('webrtc_peer_left_voice');

    socket.on('webrtc_voice_users_list', ({ users }) => {
      if (Array.isArray(users)) {
        const userSet = new Set(users.map(u => String(u)));
        const myUid = useRoomStore.getState().userId;
        if (get().isInVoice && myUid) {
          userSet.add(String(myUid));
        }
        set({ roomVoiceUsers: userSet });
      }
    });

    socket.on('webrtc_peer_left_voice', ({ userId }) => {
      const uidStr = String(userId);
      const myUid = String(useRoomStore.getState().userId || '');
      if (uidStr === myUid && get().isInVoice) return;
      const roomVoiceUsers = new Set(get().roomVoiceUsers);
      roomVoiceUsers.delete(uidStr);
      set({ roomVoiceUsers });
    });

    // Handle host-initiated mute
    const handleHostMute = () => {
      const { isInVoice, isMuted, toggleMute } = get();
      if (isInVoice && !isMuted) {
        toggleMute();
      }
    };
    window.removeEventListener('onsh_host_muted', handleHostMute);
    window.addEventListener('onsh_host_muted', handleHostMute);

    // Auto-unlock audio on user gesture
    const unlockAllAudio = () => {
      Object.values(get().remoteAudioElements).forEach(audio => {
        if (audio && audio.paused) {
          audio.play().catch(() => {});
        }
      });
      const lk = get().livekitRoom;
      if (lk && lk.startAudio) {
        lk.startAudio().catch(() => {});
      }
    };
    window.removeEventListener('click', unlockAllAudio);
    window.removeEventListener('touchstart', unlockAllAudio);
    window.addEventListener('click', unlockAllAudio, { passive: true });
    window.addEventListener('touchstart', unlockAllAudio, { passive: true });

    if (currentRoomId && socket.connected) {
      socket.emit('webrtc_get_voice_users', { roomId: currentRoomId });
    }
  },

  joinVoice: async () => {
    if (get().isInVoice || get().isConnecting) return;
    set({ isConnecting: true, error: null, audioBlocked: false });

    try {
      const myUserId = String(useRoomStore.getState().userId || '');
      const roomId = useRoomStore.getState().roomId;
      const nickname = useRoomStore.getState().nickname || 'Участник';
      const socket = useRoomStore.getState().socket;

      if (!roomId || !myUserId) {
        throw new Error('ID комнаты или пользователя не найден');
      }

      // Obtain LiveKit access token from the backend. The signing secret must
      // never be exposed to the client, so there is no client-side fallback here —
      // if the backend can't issue a token, voice chat simply can't start.
      let token = null;
      let serverUrl = LIVEKIT_DEFAULT_URL;

      try {
        let res = await fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}/voice-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: myUserId, nickname }),
        }).catch(() => null);

        if (!res || !res.ok) {
          res = await fetch(`${API_URL}/api/voice-token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roomId, userId: myUserId, nickname }),
          }).catch(() => null);
        }

        if (res && res.ok) {
          const data = await res.json().catch(() => ({}));
          if (data.token) {
            token = data.token;
            serverUrl = data.serverUrl || serverUrl;
          }
        }
      } catch (fetchErr) {
        console.warn('Backend voice-token error:', fetchErr);
      }

      if (!token) {
        throw new Error('Не удалось получить токен подключения к голосовому чату. Попробуйте ещё раз позже.');
      }

      // 2. Initialize LiveKit Room
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      // 3. Setup event listeners
      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind === Track.Kind.Audio) {
          const audioEl = track.attach();
          audioEl.style.position = 'fixed';
          audioEl.style.top = '-9999px';
          audioEl.style.left = '-9999px';
          audioEl.style.width = '1px';
          audioEl.style.height = '1px';
          audioEl.style.opacity = '0.01';
          audioEl.style.pointerEvents = 'none';
          document.body.appendChild(audioEl);

          audioEl.play().catch(e => {
            console.warn('[VOICE] Autoplay blocked, needs user interaction:', e);
            set({ audioBlocked: true });
          });

          set(prev => ({
            peerConnectionStates: { ...prev.peerConnectionStates, [participant.identity]: 'connected' },
            remoteAudioElements: { ...prev.remoteAudioElements, [participant.identity]: audioEl },
          }));
        }
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        track.detach().forEach(el => el.remove());
        set(prev => {
          const updated = { ...prev.remoteAudioElements };
          delete updated[participant.identity];
          return { remoteAudioElements: updated };
        });
      });

      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const speakingIds = new Set(speakers.map(s => String(s.identity)));
        set({ talkingUsers: speakingIds });
      });

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        const pid = String(participant.identity);
        set(prev => {
          const roomVoiceUsers = new Set(prev.roomVoiceUsers);
          roomVoiceUsers.add(pid);
          const activeSpeakers = new Set(prev.activeSpeakers);
          activeSpeakers.add(pid);
          return {
            roomVoiceUsers,
            activeSpeakers,
            peerConnectionStates: { ...prev.peerConnectionStates, [pid]: 'connected' },
          };
        });
        showToast(`${participant.name || 'Участник'} подключился к голосовому чату`, 'info');
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        const pid = String(participant.identity);
        set(prev => {
          const roomVoiceUsers = new Set(prev.roomVoiceUsers);
          roomVoiceUsers.delete(pid);
          const activeSpeakers = new Set(prev.activeSpeakers);
          activeSpeakers.delete(pid);
          const talkingUsers = new Set(prev.talkingUsers);
          talkingUsers.delete(pid);
          const peerConnectionStates = { ...prev.peerConnectionStates };
          delete peerConnectionStates[pid];
          return {
            roomVoiceUsers,
            activeSpeakers,
            talkingUsers,
            peerConnectionStates,
          };
        });
      });

      room.on(RoomEvent.Disconnected, () => {
        get().leaveVoice();
      });

      // 4. Connect to the LiveKit SFU server
      await room.connect(serverUrl, token);

      // 5. Publish microphone audio track
      await room.localParticipant.setMicrophoneEnabled(true);

      // Collect existing participants
      const initialUsers = new Set([myUserId]);
      const initialStates = {};
      room.remoteParticipants.forEach(p => {
        const pid = String(p.identity);
        initialUsers.add(pid);
        initialStates[pid] = 'connected';
      });

      // Notify Socket.IO room for spectators
      if (socket && socket.connected) {
        socket.emit('webrtc_join_voice', { roomId, userId: myUserId, nickname });
      }

      // Heartbeat to keep Redis presence active
      if (get().voiceHeartbeatInterval) {
        clearInterval(get().voiceHeartbeatInterval);
      }
      const heartbeat = setInterval(() => {
        const s = useRoomStore.getState().socket;
        const rId = useRoomStore.getState().roomId;
        const uId = useRoomStore.getState().userId;
        if (get().isInVoice && s && s.connected && rId && uId) {
          s.emit('webrtc_voice_ping', { roomId: rId, userId: String(uId) });
        }
      }, 10000);

      set({
        isInVoice: true,
        isMuted: false,
        isConnecting: false,
        audioBlocked: false,
        livekitRoom: room,
        voiceHeartbeatInterval: heartbeat,
        roomVoiceUsers: initialUsers,
        activeSpeakers: initialUsers,
        peerConnectionStates: initialStates,
      });

      showToast('Вы подключились к голосовому чату', 'success');
    } catch (err) {
      console.error('Error joining voice:', err);
      let message = 'Не удалось подключиться к голосовому чату';
      if (err.name === 'NotAllowedError') {
        message = 'Доступ к микрофону заблокирован в браузере';
      } else if (err.name === 'NotFoundError') {
        message = 'Микрофон не найден на устройстве';
      } else if (err.message) {
        message = err.message;
      }
      set({ error: message, isConnecting: false });
      showToast(message, 'error');
    }
  },

  leaveVoice: async () => {
    const { livekitRoom, voiceHeartbeatInterval, remoteAudioElements } = get();
    if (voiceHeartbeatInterval) {
      clearInterval(voiceHeartbeatInterval);
    }

    if (livekitRoom) {
      try {
        await livekitRoom.disconnect();
      } catch (e) {}
    }

    const socket = useRoomStore.getState().socket;
    const myUserId = String(useRoomStore.getState().userId || '');
    const roomId = useRoomStore.getState().roomId;
    if (socket && socket.connected && roomId) {
      socket.emit('webrtc_leave_voice', { roomId, userId: myUserId });
    }

    // Remove attached audio elements
    Object.values(remoteAudioElements).forEach(el => {
      try { el.remove(); } catch (e) {}
    });

    const roomVoiceUsers = new Set(get().roomVoiceUsers);
    if (myUserId) roomVoiceUsers.delete(myUserId);

    set({
      isInVoice: false,
      isMuted: false,
      isConnecting: false,
      livekitRoom: null,
      remoteAudioElements: {},
      roomVoiceUsers,
      activeSpeakers: new Set(),
      talkingUsers: new Set(),
      peerConnectionStates: {},
      error: null,
    });

    showToast('Вы отключились от голосового чата', 'info');
  },

  toggleMute: async () => {
    const { livekitRoom, isMuted } = get();
    if (!livekitRoom || !livekitRoom.localParticipant) return;

    try {
      const newMuted = !isMuted;
      await livekitRoom.localParticipant.setMicrophoneEnabled(!newMuted);
      set({ isMuted: newMuted });

      if (newMuted) {
        const myUserId = String(useRoomStore.getState().userId || '');
        const current = new Set(get().talkingUsers);
        current.delete(myUserId);
        set({ talkingUsers: current });
      }
    } catch (e) {
      console.error('Error toggling mute:', e);
    }
  },
}));

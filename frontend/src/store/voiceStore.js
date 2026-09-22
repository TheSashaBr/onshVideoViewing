import { create } from 'zustand';
import { Room, RoomEvent, Track } from 'livekit-client';
import { useRoomStore } from './roomStore';
import { showToast } from '../components/ToastContainer';
import { API_URL } from '../utils/api';
const LIVEKIT_DEFAULT_URL = 'wss://onshvideowatching-jbxlr1u5.livekit.cloud';

async function fetchVoiceToken(roomId, userId, nickname) {
  let token = null;
  let serverUrl = LIVEKIT_DEFAULT_URL;

  try {
    let res = await fetch(`${API_URL}/api/rooms/${encodeURIComponent(roomId)}/voice-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, nickname }),
    }).catch(() => null);

    if (!res || !res.ok) {
      res = await fetch(`${API_URL}/api/voice-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, userId, nickname }),
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

  return { token, serverUrl };
}

export const useVoiceStore = create((set, get) => ({
  isInVoice: false,
  isMuted: false,
  isConnecting: false,
  audioBlocked: false, // browser autoplay policy requires user interaction
  peerConnectionStates: {}, // { [userId]: 'connecting' | 'connected' | 'failed' }
  roomVoiceUsers: new Set(), // Set of all userIds currently in voice in this room (server-authoritative, see initVoiceRoomListeners)
  talkingUsers: new Set(), // Set of userIds currently speaking
  error: null,

  livekitRoom: null,
  remoteAudioElements: {},
  voiceHeartbeatInterval: null,

  // --- Local video streaming (screen/tab capture relayed through the same LiveKit room) ---
  isScreenSharing: false,
  isWatchingStream: false,
  isStreamConnecting: false,
  localScreenStream: null,
  screenPublications: [],
  remoteVideoTrack: null,
  remoteVideoOwnerId: null,

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
    socket.off('stream_conflict');

    // The server rejected our LOAD_VIDEO('local-stream') because someone
    // else is already actively presenting — stop the publish we already
    // started rather than leaving it running in the background for nothing.
    socket.on('stream_conflict', () => {
      const members = useRoomStore.getState().members;
      const ownerId = useRoomStore.getState().roomState.videoOwnerId;
      const owner = members.find(m => String(m.userId) === String(ownerId));
      showToast(`${owner?.nickname || 'Другой участник'} уже транслирует экран в этой комнате`, 'warning', 3500);
      get().stopScreenShare();
    });

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

  // Connects to the room's LiveKit session if not already connected. Shared
  // by voice chat, screen-sharing and stream-watching — all three ride the
  // same underlying Room/connection, refcounted by their own boolean flags
  // (see maybeDisconnectLiveKit), so leaving one doesn't tear down another.
  ensureLiveKitConnected: async () => {
    const existing = get().livekitRoom;
    if (existing) return existing;

    const myUserId = String(useRoomStore.getState().userId || '');
    const roomId = useRoomStore.getState().roomId;
    const nickname = useRoomStore.getState().nickname || 'Участник';

    if (!roomId || !myUserId) {
      throw new Error('ID комнаты или пользователя не найден');
    }

    const { token, serverUrl } = await fetchVoiceToken(roomId, myUserId, nickname);
    if (!token) {
      throw new Error('Не удалось получить токен подключения. Попробуйте ещё раз позже.');
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

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
      } else if (track.kind === Track.Kind.Video) {
        set({ remoteVideoTrack: track, remoteVideoOwnerId: String(participant.identity) });
      }
    });

    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      if (track.kind === Track.Kind.Audio) {
        track.detach().forEach(el => el.remove());
        set(prev => {
          const updated = { ...prev.remoteAudioElements };
          delete updated[participant.identity];
          return { remoteAudioElements: updated };
        });
      } else if (track.kind === Track.Kind.Video) {
        track.detach();
        set(prev => (
          prev.remoteVideoOwnerId === String(participant.identity)
            ? { remoteVideoTrack: null, remoteVideoOwnerId: null }
            : {}
        ));
      }
    });

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      set({ talkingUsers: new Set(speakers.map(s => String(s.identity))) });
    });

    // roomVoiceUsers (who is "in voice chat") is authoritatively driven by the
    // Socket.IO-broadcast presence list (see initVoiceRoomListeners) — being
    // connected to the LiveKit room does not by itself mean "in voice chat",
    // since a participant may be connected only to watch a shared stream. We
    // still track per-participant connection health here for the UI badges.
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      const pid = String(participant.identity);
      set(prev => ({ peerConnectionStates: { ...prev.peerConnectionStates, [pid]: 'connected' } }));
    });

    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      const pid = String(participant.identity);
      set(prev => {
        const talkingUsers = new Set(prev.talkingUsers);
        talkingUsers.delete(pid);
        const peerConnectionStates = { ...prev.peerConnectionStates };
        delete peerConnectionStates[pid];
        return { talkingUsers, peerConnectionStates };
      });
      if (get().remoteVideoOwnerId === pid) {
        set({ remoteVideoTrack: null, remoteVideoOwnerId: null });
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      get()._resetAllVoiceState();
    });

    await room.connect(serverUrl, token);
    set({ livekitRoom: room });
    return room;
  },

  // Disconnects from LiveKit only once nothing needs it any more.
  maybeDisconnectLiveKit: async () => {
    const { isInVoice, isScreenSharing, isWatchingStream, livekitRoom } = get();
    if (isInVoice || isScreenSharing || isWatchingStream) return;
    if (livekitRoom) {
      try {
        await livekitRoom.disconnect();
      } catch (e) {}
    }
  },

  // Full local-state reset — only safe to run once the LiveKit connection has
  // actually dropped (fired from RoomEvent.Disconnected), since it clears
  // state shared across voice/screen-share/watch.
  _resetAllVoiceState: () => {
    const { voiceHeartbeatInterval, remoteAudioElements, localScreenStream } = get();
    if (voiceHeartbeatInterval) clearInterval(voiceHeartbeatInterval);
    Object.values(remoteAudioElements).forEach(el => {
      try { el.remove(); } catch (e) {}
    });
    if (localScreenStream) {
      localScreenStream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
    }

    const myUserId = String(useRoomStore.getState().userId || '');
    const roomVoiceUsers = new Set(get().roomVoiceUsers);
    roomVoiceUsers.delete(myUserId);

    set({
      isInVoice: false,
      isMuted: false,
      isConnecting: false,
      isScreenSharing: false,
      isWatchingStream: false,
      isStreamConnecting: false,
      livekitRoom: null,
      remoteAudioElements: {},
      remoteVideoTrack: null,
      remoteVideoOwnerId: null,
      localScreenStream: null,
      screenPublications: [],
      roomVoiceUsers,
      talkingUsers: new Set(),
      peerConnectionStates: {},
      voiceHeartbeatInterval: null,
    });
  },

  joinVoice: async () => {
    if (get().isInVoice || get().isConnecting) return;
    set({ isConnecting: true, error: null, audioBlocked: false });

    try {
      const room = await get().ensureLiveKitConnected();
      await room.localParticipant.setMicrophoneEnabled(true);

      const myUserId = String(useRoomStore.getState().userId || '');
      const roomId = useRoomStore.getState().roomId;
      const nickname = useRoomStore.getState().nickname || 'Участник';
      const socket = useRoomStore.getState().socket;

      const initialStates = {};
      room.remoteParticipants.forEach(p => {
        initialStates[String(p.identity)] = 'connected';
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

      set(prev => ({
        isInVoice: true,
        isMuted: false,
        isConnecting: false,
        audioBlocked: false,
        voiceHeartbeatInterval: heartbeat,
        roomVoiceUsers: new Set([...prev.roomVoiceUsers, myUserId]),
        peerConnectionStates: { ...prev.peerConnectionStates, ...initialStates },
      }));

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
      get().maybeDisconnectLiveKit();
    }
  },

  leaveVoice: async () => {
    const socket = useRoomStore.getState().socket;
    const myUserId = String(useRoomStore.getState().userId || '');
    const roomId = useRoomStore.getState().roomId;
    if (socket && socket.connected && roomId) {
      socket.emit('webrtc_leave_voice', { roomId, userId: myUserId });
    }

    const { voiceHeartbeatInterval } = get();
    if (voiceHeartbeatInterval) clearInterval(voiceHeartbeatInterval);

    const roomVoiceUsers = new Set(get().roomVoiceUsers);
    if (myUserId) roomVoiceUsers.delete(myUserId);

    set({
      isInVoice: false,
      isMuted: false,
      isConnecting: false,
      voiceHeartbeatInterval: null,
      roomVoiceUsers,
      error: null,
    });

    if (get().isScreenSharing || get().isWatchingStream) {
      // Still connected for another reason — stop transmitting our mic but
      // keep the connection (and everyone else's audio/video) alive.
      const lk = get().livekitRoom;
      if (lk && lk.localParticipant) {
        try {
          await lk.localParticipant.setMicrophoneEnabled(false);
        } catch (e) {}
      }
    } else {
      await get().maybeDisconnectLiveKit();
    }

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

  // --- Local video streaming (screen/tab share) ---

  startScreenShare: async () => {
    if (get().isScreenSharing || get().isStreamConnecting) return;

    // Fast client-side check using already-synced room state, so we don't
    // make someone pick a screen/window just to get rejected — the server
    // (see stream_conflict above) is still the authoritative guard for races.
    const currentRoomState = useRoomStore.getState().roomState;
    const myUserId = String(useRoomStore.getState().userId || '');
    if (currentRoomState.videoType === 'local-stream' && currentRoomState.videoOwnerId
        && String(currentRoomState.videoOwnerId) !== myUserId) {
      const owner = useRoomStore.getState().members.find(m => String(m.userId) === String(currentRoomState.videoOwnerId));
      showToast(`${owner?.nickname || 'Другой участник'} уже транслирует экран в этой комнате`, 'warning', 3500);
      return;
    }

    set({ isStreamConnecting: true, error: null });

    let displayStream = null;
    try {
      try {
        displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch (err) {
        if (err.name === 'NotAllowedError') {
          // User dismissed the browser's picker — not a real error.
          set({ isStreamConnecting: false });
          return;
        }
        throw err;
      }

      const room = await get().ensureLiveKitConnected();

      const publications = [];
      for (const track of displayStream.getTracks()) {
        track.onended = () => {
          // Fired when the user stops sharing via the browser's own control
          // (not our "Остановить трансляцию" button).
          get().stopScreenShare();
        };
        const source = track.kind === 'video' ? Track.Source.ScreenShare : Track.Source.ScreenShareAudio;
        const pub = await room.localParticipant.publishTrack(track, { source });
        publications.push(pub);
      }

      set({
        isScreenSharing: true,
        isStreamConnecting: false,
        localScreenStream: displayStream,
        screenPublications: publications,
      });

      useRoomStore.getState().loadVideo('local-stream', 'local-stream');
      showToast('Трансляция начата', 'success');
    } catch (err) {
      console.error('Error starting screen share:', err);
      if (displayStream) {
        displayStream.getTracks().forEach(t => {
          try { t.stop(); } catch (e) {}
        });
      }
      let message = 'Не удалось начать трансляцию';
      if (err.name === 'NotAllowedError') {
        message = 'Доступ к экрану заблокирован';
      } else if (err.message) {
        message = err.message;
      }
      set({ error: message, isStreamConnecting: false });
      showToast(message, 'error');
      get().maybeDisconnectLiveKit();
    }
  },

  stopScreenShare: async () => {
    if (!get().isScreenSharing) return;

    const { localScreenStream, screenPublications, livekitRoom } = get();

    if (livekitRoom) {
      for (const pub of screenPublications) {
        try {
          await livekitRoom.localParticipant.unpublishTrack(pub.track, true);
        } catch (e) {}
      }
    }
    if (localScreenStream) {
      localScreenStream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
    }

    set({ isScreenSharing: false, localScreenStream: null, screenPublications: [] });

    // Clear the shared room state back to empty so everyone else's player
    // returns to the "what are we watching" screen.
    if (useRoomStore.getState().roomState.videoType === 'local-stream') {
      useRoomStore.getState().loadVideo('', 'youtube');
    }

    await get().maybeDisconnectLiveKit();
    showToast('Трансляция остановлена', 'info');
  },

  watchStream: async () => {
    if (get().isWatchingStream || get().isScreenSharing || get().isStreamConnecting) return;
    set({ isStreamConnecting: true });
    try {
      await get().ensureLiveKitConnected();
      set({ isWatchingStream: true, isStreamConnecting: false });
    } catch (err) {
      console.error('Error watching stream:', err);
      set({ isStreamConnecting: false });
      showToast('Не удалось подключиться к трансляции', 'error');
    }
  },

  stopWatchingStream: async () => {
    if (!get().isWatchingStream) return;
    set({ isWatchingStream: false, remoteVideoTrack: null, remoteVideoOwnerId: null });
    await get().maybeDisconnectLiveKit();
  },
}));

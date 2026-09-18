import { create } from 'zustand';
import { useRoomStore } from './roomStore';
import { showToast } from '../components/ToastContainer';

// Public STUN servers for NAT traversal
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
  ],
};

export const useVoiceStore = create((set, get) => ({
  isInVoice: false,
  isMuted: false,
  isConnecting: false,
  roomVoiceUsers: new Set(), // Set of all userIds currently in voice in this room
  activeSpeakers: new Set(), // Set of userIds who are in voice peer connections
  talkingUsers: new Set(), // Set of userIds currently speaking (audio level > threshold)
  error: null,

  localStream: null,
  peerConnections: {}, // { [userId]: RTCPeerConnection }
  remoteAudioElements: {}, // { [userId]: HTMLAudioElement }
  audioAnalysers: {}, // { [userId]: AnalyserNode }
  animationFrameId: null,

  initVoiceRoomListeners: (socket) => {
    if (!socket) return;

    socket.off('webrtc_voice_users_list');
    socket.on('webrtc_voice_users_list', ({ users }) => {
      if (Array.isArray(users)) {
        set({ roomVoiceUsers: new Set(users) });
      }
    });

    socket.emit('webrtc_get_voice_users');
  },

  joinVoice: async () => {
    if (get().isInVoice || get().isConnecting) return;
    set({ isConnecting: true, error: null });

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Голосовой чат требует безопасного соединения (HTTPS)');
      }

      // 1. Get user microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      set({ localStream: stream });

      const socket = useRoomStore.getState().socket;
      const myUserId = useRoomStore.getState().userId;

      if (!socket || !socket.connected) {
        throw new Error('Нет подключения к серверу');
      }

      // 2. Setup socket signaling listeners
      get().setupSignaling(socket, myUserId, stream);

      // 3. Notify room members that we joined voice
      socket.emit('webrtc_join_voice');

      const roomVoiceUsers = new Set(get().roomVoiceUsers);
      roomVoiceUsers.add(myUserId);

      set({
        isInVoice: true,
        isConnecting: false,
        roomVoiceUsers,
        activeSpeakers: new Set([myUserId]),
      });

      // 4. Start local speaking detection
      get().startSpeakingDetection(myUserId, stream, true);

      showToast('Вы подключились к голосовому чату', 'success');
    } catch (err) {
      console.error('Error joining voice:', err);
      let message = 'Не удалось получить доступ к микрофону';
      if (err.message?.includes('HTTPS')) {
        message = err.message;
      } else if (err.name === 'NotAllowedError') {
        message = 'Доступ к микрофону заблокирован в браузере';
      } else if (err.name === 'NotFoundError') {
        message = 'Микрофон не найден на устройстве';
      }
      set({ error: message, isConnecting: false });
      showToast(message, 'error');
    }
  },

  leaveVoice: () => {
    const { localStream, peerConnections, remoteAudioElements, animationFrameId } = get();
    const socket = useRoomStore.getState().socket;

    if (socket && socket.connected) {
      socket.emit('webrtc_leave_voice');
    }

    // Stop local microphone tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    // Close all WebRTC peer connections
    Object.values(peerConnections).forEach(pc => {
      try {
        pc.close();
      } catch (e) {}
    });

    // Remove and stop all remote audio elements
    Object.values(remoteAudioElements).forEach(audio => {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      } catch (e) {}
    });

    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
    }

    const roomVoiceUsers = new Set(get().roomVoiceUsers);
    const myUserId = useRoomStore.getState().userId;
    if (myUserId) roomVoiceUsers.delete(myUserId);

    set({
      isInVoice: false,
      isMuted: false,
      isConnecting: false,
      localStream: null,
      peerConnections: {},
      remoteAudioElements: {},
      roomVoiceUsers,
      activeSpeakers: new Set(),
      talkingUsers: new Set(),
      animationFrameId: null,
      error: null,
    });

    showToast('Вы отключились от голосового чата', 'info');
  },

  toggleMute: () => {
    const { localStream, isMuted } = get();
    if (!localStream) return;

    const newMuted = !isMuted;
    localStream.getAudioTracks().forEach(track => {
      track.enabled = !newMuted;
    });

    set({ isMuted: newMuted });
    if (newMuted) {
      const myUserId = useRoomStore.getState().userId;
      const current = new Set(get().talkingUsers);
      current.delete(myUserId);
      set({ talkingUsers: current });
    }
  },

  setupSignaling: (socket, myUserId, stream) => {
    // Remove old listeners to prevent duplicates
    socket.off('webrtc_peer_joined_voice');
    socket.off('webrtc_peer_left_voice');
    socket.off('webrtc_signal_relay');
    socket.off('webrtc_existing_voice_peers');

    // Handle list of peers already active in voice when we joined
    socket.on('webrtc_existing_voice_peers', ({ users }) => {
      if (!Array.isArray(users)) return;
      const currentSpeakers = new Set(get().activeSpeakers);
      const currentRoomVoice = new Set(get().roomVoiceUsers);
      users.forEach(u => {
        if (u.userId) {
          currentSpeakers.add(u.userId);
          currentRoomVoice.add(u.userId);
        }
      });
      set({ activeSpeakers: currentSpeakers, roomVoiceUsers: currentRoomVoice });
    });

    // When another peer joins voice, create an offer if our ID is initiator (or we are already in voice)
    socket.on('webrtc_peer_joined_voice', async ({ userId: peerId, nickname }) => {
      if (peerId === myUserId) return;

      const currentSpeakers = new Set(get().activeSpeakers);
      currentSpeakers.add(peerId);
      const currentRoomVoice = new Set(get().roomVoiceUsers);
      currentRoomVoice.add(peerId);
      set({ activeSpeakers: currentSpeakers, roomVoiceUsers: currentRoomVoice });

      showToast(`${nickname || 'Участник'} подключился к голосовому чату`, 'info');

      // Create peer connection and offer to the newcomer
      await get().createPeerConnection(peerId, true, stream);
    });

    // When a peer leaves voice
    socket.on('webrtc_peer_left_voice', ({ userId: peerId }) => {
      const currentRoomVoice = new Set(get().roomVoiceUsers);
      currentRoomVoice.delete(peerId);
      set({ roomVoiceUsers: currentRoomVoice });
      get().removePeer(peerId);
    });

    // Incoming WebRTC signal (offer, answer, candidate)
    socket.on('webrtc_signal_relay', async ({ senderUserId, targetUserId, signal }) => {
      if (targetUserId !== myUserId) return;

      let pc = get().peerConnections[senderUserId];

      if (!pc && signal.type === 'offer') {
        const currentSpeakers = new Set(get().activeSpeakers);
        currentSpeakers.add(senderUserId);
        const currentRoomVoice = new Set(get().roomVoiceUsers);
        currentRoomVoice.add(senderUserId);
        set({ activeSpeakers: currentSpeakers, roomVoiceUsers: currentRoomVoice });

        // Create connection as answerer
        pc = await get().createPeerConnection(senderUserId, false, stream);
      }

      if (!pc) return;

      try {
        if (signal.type === 'offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit('webrtc_signal', {
            targetUserId: senderUserId,
            signal: answer,
          });
        } else if (signal.type === 'answer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signal));
        } else if (signal.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (err) {
        console.error('Error handling WebRTC signal:', err);
      }
    });
  },

  createPeerConnection: async (peerId, isInitiator, stream) => {
    const socket = useRoomStore.getState().socket;
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Add local tracks to send to peer
    stream.getAudioTracks().forEach(track => {
      pc.addTrack(track, stream);
    });

    // Send ICE candidates to peer via socket
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc_signal', {
          targetUserId: peerId,
          signal: { candidate: event.candidate },
        });
      }
    };

    // Receive incoming audio track from peer
    pc.ontrack = (event) => {
      const remoteStream = event.streams[0];
      let audio = get().remoteAudioElements[peerId];
      if (!audio) {
        audio = new Audio();
        audio.autoplay = true;
        audio.playsInline = true;
        document.body.appendChild(audio);

        set(state => ({
          remoteAudioElements: { ...state.remoteAudioElements, [peerId]: audio },
        }));
      }

      audio.srcObject = remoteStream;
      audio.play().catch(e => console.warn('Autoplay prevented on audio:', e));

      // Speaking detection for remote peer
      get().startSpeakingDetection(peerId, remoteStream, false);
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        get().removePeer(peerId);
      }
    };

    set(state => ({
      peerConnections: { ...state.peerConnections, [peerId]: pc },
    }));

    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('webrtc_signal', {
          targetUserId: peerId,
          signal: offer,
        });
      } catch (err) {
        console.error('Error creating WebRTC offer:', err);
      }
    }

    return pc;
  },

  removePeer: (peerId) => {
    const pc = get().peerConnections[peerId];
    if (pc) {
      try {
        pc.close();
      } catch (e) {}
    }

    const audio = get().remoteAudioElements[peerId];
    if (audio) {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      } catch (e) {}
    }

    const updatedPcs = { ...get().peerConnections };
    delete updatedPcs[peerId];

    const updatedAudios = { ...get().remoteAudioElements };
    delete updatedAudios[peerId];

    const updatedSpeakers = new Set(get().activeSpeakers);
    updatedSpeakers.delete(peerId);

    const updatedTalking = new Set(get().talkingUsers);
    updatedTalking.delete(peerId);

    set({
      peerConnections: updatedPcs,
      remoteAudioElements: updatedAudios,
      activeSpeakers: updatedSpeakers,
      talkingUsers: updatedTalking,
    });
  },

  startSpeakingDetection: (userId, stream, isLocal = false) => {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.4;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkAudioLevel = () => {
        if (!get().isInVoice) {
          audioContext.close().catch(() => {});
          return;
        }

        // If muted locally, force not talking
        if (isLocal && get().isMuted) {
          const current = new Set(get().talkingUsers);
          if (current.has(userId)) {
            current.delete(userId);
            set({ talkingUsers: current });
          }
          requestAnimationFrame(checkAudioLevel);
          return;
        }

        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // Threshold for human speech activity
        const isTalking = average > 14;
        const currentTalking = new Set(get().talkingUsers);

        if (isTalking && !currentTalking.has(userId)) {
          currentTalking.add(userId);
          set({ talkingUsers: currentTalking });
        } else if (!isTalking && currentTalking.has(userId)) {
          currentTalking.delete(userId);
          set({ talkingUsers: currentTalking });
        }

        requestAnimationFrame(checkAudioLevel);
      };

      requestAnimationFrame(checkAudioLevel);
    } catch (e) {
      console.warn('AudioAnalyser speech detection not supported:', e);
    }
  },
}));

import { create } from 'zustand';
import { useRoomStore } from './roomStore';
import { showToast } from '../components/ToastContainer';

// High-reliability public STUN servers for NAT traversal (no expiring/flaky TURN servers)
const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'stun:global.stun.twilio.com:3478' },
    { urls: 'stun:stun.services.mozilla.com' },
  ],
  iceCandidatePoolSize: 10,
};

export const useVoiceStore = create((set, get) => ({
  isInVoice: false,
  isMuted: false,
  isConnecting: false,
  roomVoiceUsers: new Set(), // Set of all userIds currently in voice in this room
  activeSpeakers: new Set(), // Set of userIds with active peer connections
  talkingUsers: new Set(), // Set of userIds currently speaking (audio level > threshold)
  error: null,

  localStream: null,
  sharedAudioContext: null,
  peerConnections: {}, // { [userId]: RTCPeerConnection }
  remoteAudioElements: {}, // { [userId]: HTMLAudioElement }
  pendingCandidates: {}, // { [userId]: RTCIceCandidateInit[] }

  // Global room listener initialized on room join (works even before user clicks join voice)
  initVoiceRoomListeners: (socket) => {
    if (!socket) return;

    socket.off('webrtc_voice_users_list');
    socket.off('webrtc_peer_left_voice');

    socket.on('webrtc_voice_users_list', ({ users }) => {
      if (Array.isArray(users)) {
        const userSet = new Set(users.map(u => String(u)));
        // If current user is locally in voice, preserve local presence
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
      // Don't remove self unless we've actually left voice
      if (uidStr === myUid && get().isInVoice) {
        return;
      }
      const roomVoiceUsers = new Set(get().roomVoiceUsers);
      roomVoiceUsers.delete(uidStr);
      set({ roomVoiceUsers });
      if (get().isInVoice) {
        get().removePeer(uidStr);
      }
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

    socket.emit('webrtc_get_voice_users');
  },

  joinVoice: async () => {
    if (get().isInVoice || get().isConnecting) return;
    set({ isConnecting: true, error: null });

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Голосовой чат требует безопасного соединения (HTTPS)');
      }

      // 1. Initialize or resume shared AudioContext on user gesture
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      let ctx = get().sharedAudioContext;
      if (!ctx || ctx.state === 'closed') {
        ctx = new AudioCtx();
      }
      if (ctx.state === 'suspended') {
        await ctx.resume().catch(() => {});
      }
      set({ sharedAudioContext: ctx });

      // 2. Get user microphone stream with audio enhancements
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
        video: false,
      });

      // Ensure audio track is enabled
      stream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });

      set({ localStream: stream });

      const socket = useRoomStore.getState().socket;
      const myUserId = String(useRoomStore.getState().userId);

      if (!socket || !socket.connected) {
        throw new Error('Нет подключения к серверу комнаты');
      }

      // 3. Setup WebRTC signaling socket handlers
      get().setupSignaling(socket, myUserId, stream);

      // 4. Notify server that we joined voice
      socket.emit('webrtc_join_voice');

      const roomVoiceUsers = new Set(get().roomVoiceUsers);
      roomVoiceUsers.add(myUserId);

      set({
        isInVoice: true,
        isMuted: false,
        isConnecting: false,
        roomVoiceUsers,
        activeSpeakers: new Set([myUserId]),
      });

      // 5. Local speech activity detection
      get().startLocalSpeechDetection(myUserId, stream, ctx);

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
    const { localStream, peerConnections, remoteAudioElements, sharedAudioContext } = get();
    const socket = useRoomStore.getState().socket;
    const myUserId = String(useRoomStore.getState().userId || '');

    if (socket && socket.connected) {
      socket.emit('webrtc_leave_voice');
    }

    // Stop all microphone tracks
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
    }

    // Close all WebRTC peer connections
    Object.values(peerConnections).forEach(pc => {
      try {
        pc.close();
      } catch (e) {}
    });

    // Remove all remote audio elements
    Object.values(remoteAudioElements).forEach(audio => {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      } catch (e) {}
    });

    const roomVoiceUsers = new Set(get().roomVoiceUsers);
    if (myUserId) roomVoiceUsers.delete(myUserId);

    set({
      isInVoice: false,
      isMuted: false,
      isConnecting: false,
      localStream: null,
      peerConnections: {},
      remoteAudioElements: {},
      pendingCandidates: {},
      roomVoiceUsers,
      activeSpeakers: new Set(),
      talkingUsers: new Set(),
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
      const myUserId = String(useRoomStore.getState().userId);
      const current = new Set(get().talkingUsers);
      current.delete(myUserId);
      set({ talkingUsers: current });
    }
  },

  setupSignaling: (socket, myUserId, stream) => {
    socket.off('webrtc_peer_joined_voice');
    socket.off('webrtc_existing_voice_peers');
    socket.off('webrtc_signal_relay');

    // List of peers who were already in voice before we joined
    socket.on('webrtc_existing_voice_peers', async ({ users }) => {
      if (!Array.isArray(users)) return;
      const currentSpeakers = new Set(get().activeSpeakers);
      const currentRoomVoice = new Set(get().roomVoiceUsers);

      users.forEach(u => {
        if (u && u.userId) {
          const uid = String(u.userId);
          currentSpeakers.add(uid);
          currentRoomVoice.add(uid);
        }
      });
      set({ activeSpeakers: currentSpeakers, roomVoiceUsers: currentRoomVoice });

      // NOTE: Strict one-way negotiation. As newcomer, we do NOT initiate offers to existing peers.
      // The existing peers receive 'webrtc_peer_joined_voice' and send the offer to us.
      // We will answer their offers when received in 'webrtc_signal_relay'.
      // This completely eliminates WebRTC glare and negotiation collisions.
    });

    // When a new peer joins voice, existing peers initiate the connection and send the offer
    socket.on('webrtc_peer_joined_voice', async ({ userId: rawPeerId, nickname }) => {
      const peerId = String(rawPeerId);
      if (!peerId || peerId === String(myUserId)) return;

      const currentSpeakers = new Set(get().activeSpeakers);
      currentSpeakers.add(peerId);
      const currentRoomVoice = new Set(get().roomVoiceUsers);
      currentRoomVoice.add(peerId);
      set({ activeSpeakers: currentSpeakers, roomVoiceUsers: currentRoomVoice });

      if (nickname) {
        showToast(`${nickname} подключился к голосовому чату`, 'info');
      }

      // Existing peer initiates peer connection with isInitiator = true
      const activeStream = stream || get().localStream;
      if (activeStream && get().isInVoice) {
        await get().createPeerConnection(peerId, true, activeStream);
      }
    });

    // Handle incoming WebRTC signals (offer, answer, ICE candidate)
    socket.on('webrtc_signal_relay', async ({ senderUserId: rawSender, targetUserId: rawTarget, signal }) => {
      const senderUserId = String(rawSender);
      const targetUserId = String(rawTarget);

      if (targetUserId !== String(myUserId) || !signal) return;

      let pc = get().peerConnections[senderUserId];
      const activeStream = stream || get().localStream;

      // If we receive an incoming offer and don't have a peer connection yet
      if (!pc && signal.type === 'offer') {
        const currentSpeakers = new Set(get().activeSpeakers);
        currentSpeakers.add(senderUserId);
        const currentRoomVoice = new Set(get().roomVoiceUsers);
        currentRoomVoice.add(senderUserId);
        set({ activeSpeakers: currentSpeakers, roomVoiceUsers: currentRoomVoice });

        pc = await get().createPeerConnection(senderUserId, false, activeStream);
      }

      // Handle ICE Candidate
      if (signal.candidate) {
        if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
          // Queue ICE candidate until remote description is set
          const pending = get().pendingCandidates[senderUserId] || [];
          pending.push(signal.candidate);
          set(state => ({
            pendingCandidates: { ...state.pendingCandidates, [senderUserId]: pending }
          }));
          return;
        }

        try {
          await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
        } catch (err) {
          console.warn('addIceCandidate error:', err);
        }
        return;
      }

      if (!pc) return;

      try {
        if (signal.type === 'offer') {
          // In case of rare glare / simultaneous offers, tie-breaker: polite peer rolls back
          if (pc.signalingState !== 'stable') {
            const isPolite = String(myUserId) < String(senderUserId);
            if (isPolite) {
              await pc.setLocalDescription({ type: 'rollback' });
            } else {
              return; // Impolite ignores colliding offer
            }
          }

          await pc.setRemoteDescription(new RTCSessionDescription(signal));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          socket.emit('webrtc_signal', {
            targetUserId: senderUserId,
            signal: answer,
          });

          // Flush queued candidates for this peer
          await get().flushQueuedCandidates(senderUserId, pc);
        } else if (signal.type === 'answer') {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(signal));
            // Flush queued candidates for this peer
            await get().flushQueuedCandidates(senderUserId, pc);
          }
        }
      } catch (err) {
        console.error('Error handling WebRTC signal:', err);
      }
    });
  },

  flushQueuedCandidates: async (peerId, pc) => {
    const queue = get().pendingCandidates[peerId] || [];
    for (const cand of queue) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {
        console.warn('Error flushing queued ICE candidate:', e);
      }
    }
    set(state => {
      const nextPending = { ...state.pendingCandidates };
      delete nextPending[peerId];
      return { pendingCandidates: nextPending };
    });
  },

  createPeerConnection: async (peerId, isInitiator, stream) => {
    const socket = useRoomStore.getState().socket;
    const existingPc = get().peerConnections[peerId];
    if (existingPc) {
      try {
        existingPc.close();
      } catch (e) {}
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);

    // Add local microphone audio tracks
    const activeStream = stream || get().localStream;
    if (activeStream) {
      activeStream.getAudioTracks().forEach(track => {
        pc.addTrack(track, activeStream);
      });
    }

    // Send local ICE candidates to peer
    pc.onicecandidate = (event) => {
      if (event.candidate && socket && socket.connected) {
        socket.emit('webrtc_signal', {
          targetUserId: peerId,
          signal: { candidate: event.candidate },
        });
      }
    };

    // Receive incoming remote audio track
    pc.ontrack = (event) => {
      const remoteStream = (event.streams && event.streams[0])
        ? event.streams[0]
        : new MediaStream([event.track]);

      // 1. Play audio via unmuted HTMLAudioElement for native hardware AEC (acoustic echo cancellation)
      let audio = get().remoteAudioElements[peerId];
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        audio.playsInline = true;
        audio.muted = false; // Never mute playback - allows hardware echo cancellation and loud audio
        audio.volume = 1.0;
        audio.style.display = 'none';
        document.body.appendChild(audio);

        set(state => ({
          remoteAudioElements: { ...state.remoteAudioElements, [peerId]: audio },
        }));
      }

      audio.srcObject = remoteStream;
      audio.play().catch(e => {
        console.warn('Remote audio autoplay warning:', e);
      });

      // 2. Connect to Analyser for speech visualizer (do NOT connect to ctx.destination!)
      const ctx = get().sharedAudioContext;
      if (ctx) {
        try {
          if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
          }
          const source = ctx.createMediaStreamSource(remoteStream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.4;
          source.connect(analyser);
          get().startSpeechVisualizerLoop(peerId, analyser, false);
        } catch (e) {
          console.warn('Analyser routing error:', e);
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        if (typeof pc.restartIce === 'function') {
          pc.restartIce();
        }
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        console.warn(`Connection to peer ${peerId} failed, attempting reconnect...`);
        const activeStream = get().localStream;
        if (isInitiator && activeStream && get().isInVoice) {
          setTimeout(() => {
            if (get().isInVoice && get().roomVoiceUsers.has(peerId)) {
              get().createPeerConnection(peerId, true, activeStream);
            }
          }, 1500);
        }
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
    const uid = String(peerId);
    const pc = get().peerConnections[uid];
    if (pc) {
      try {
        pc.close();
      } catch (e) {}
    }

    const audio = get().remoteAudioElements[uid];
    if (audio) {
      try {
        audio.pause();
        audio.srcObject = null;
        audio.remove();
      } catch (e) {}
    }

    const updatedPcs = { ...get().peerConnections };
    delete updatedPcs[uid];

    const updatedAudios = { ...get().remoteAudioElements };
    delete updatedAudios[uid];

    const updatedPending = { ...get().pendingCandidates };
    delete updatedPending[uid];

    const updatedSpeakers = new Set(get().activeSpeakers);
    updatedSpeakers.delete(uid);

    const updatedTalking = new Set(get().talkingUsers);
    updatedTalking.delete(uid);

    set({
      peerConnections: updatedPcs,
      remoteAudioElements: updatedAudios,
      pendingCandidates: updatedPending,
      activeSpeakers: updatedSpeakers,
      talkingUsers: updatedTalking,
    });
  },

  startLocalSpeechDetection: (userId, stream, ctx) => {
    try {
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.4;

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);

      get().startSpeechVisualizerLoop(String(userId), analyser, true);
    } catch (e) {
      console.warn('Local speech detection setup error:', e);
    }
  },

  startSpeechVisualizerLoop: (userId, analyser, isLocal = false) => {
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const uid = String(userId);

    const check = () => {
      if (!get().isInVoice) return;

      if (isLocal && get().isMuted) {
        const current = new Set(get().talkingUsers);
        if (current.has(uid)) {
          current.delete(uid);
          set({ talkingUsers: current });
        }
        requestAnimationFrame(check);
        return;
      }

      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const isTalking = avg > 12;

      const current = new Set(get().talkingUsers);
      if (isTalking && !current.has(uid)) {
        current.add(uid);
        set({ talkingUsers: current });
      } else if (!isTalking && current.has(uid)) {
        current.delete(uid);
        set({ talkingUsers: current });
      }

      requestAnimationFrame(check);
    };

    requestAnimationFrame(check);
  },
}));

import { create } from 'zustand';
import { useRoomStore } from './roomStore';
import { showToast } from '../components/ToastContainer';

// High-reliability public STUN servers for NAT traversal
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
};

export const useVoiceStore = create((set, get) => ({
  isInVoice: false,
  isMuted: false,
  isConnecting: false,
  audioBlocked: false, // browser autoplay policy requires user interaction
  peerConnectionStates: {}, // { [userId]: 'connecting' | 'connected' | 'failed' | 'disconnected' }
  roomVoiceUsers: new Set(), // Set of all userIds currently in voice in this room
  activeSpeakers: new Set(), // Set of userIds with active peer connections
  talkingUsers: new Set(), // Set of userIds currently speaking (audio level > threshold)
  error: null,

  localStream: null,
  sharedAudioContext: null,
  peerConnections: {}, // { [userId]: RTCPeerConnection }
  remoteAudioElements: {}, // { [userId]: HTMLAudioElement }
  pendingCandidates: {}, // { [userId]: RTCIceCandidateInit[] }
  voiceHeartbeatInterval: null,

  // Unlock audio playback across all peers (called on user gesture or banner click)
  unlockAudioPlayback: async () => {
    const ctx = get().sharedAudioContext;
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }
    let anySuccess = false;
    for (const audio of Object.values(get().remoteAudioElements)) {
      if (audio) {
        try {
          await audio.play();
          anySuccess = true;
        } catch (e) {}
      }
    }
    set({ audioBlocked: false });
    if (anySuccess) {
      showToast('Звук в голосовом чате включен', 'success', 2500);
    }
  },

  retryPeerConnection: (peerId) => {
    const uid = String(peerId);
    const myUid = String(useRoomStore.getState().userId || '');
    const isInitiator = myUid > uid;
    const stream = get().localStream;
    if (stream && get().isInVoice) {
      set(prev => ({
        peerConnectionStates: { ...prev.peerConnectionStates, [uid]: 'connecting' }
      }));
      get().createPeerConnection(uid, isInitiator, stream);
    }
  },

  // Global room listener initialized on room join (works even before user clicks join voice)
  initVoiceRoomListeners: (socket, roomId) => {
    if (!socket) return;
    const currentRoomId = roomId || useRoomStore.getState().roomId;

    socket.off('webrtc_voice_users_list');
    socket.off('webrtc_peer_left_voice');

    socket.on('webrtc_voice_users_list', ({ users }) => {
      console.log('[WEBRTC] Received webrtc_voice_users_list:', users);
      if (Array.isArray(users)) {
        const userSet = new Set(users.map(u => String(u)));
        // If current user is locally in voice, preserve local presence
        const myUid = useRoomStore.getState().userId;
        if (get().isInVoice && myUid) {
          userSet.add(String(myUid));
        }
        set({ roomVoiceUsers: userSet });

        // Auto-connect watchdog: ensure active peers have an established connection
        if (get().isInVoice && myUid && get().localStream) {
          userSet.forEach(peerId => {
            if (peerId !== String(myUid)) {
              const isInitiator = String(myUid) > peerId;
              const pc = get().peerConnections[peerId];
              const isWorking = pc && (
                pc.connectionState === 'connected' ||
                pc.connectionState === 'connecting' ||
                pc.connectionState === 'new'
              );
              if (isInitiator && !isWorking) {
                console.log(`[WEBRTC] Watchdog: auto-initiating connection to active peer ${peerId}`);
                get().createPeerConnection(peerId, true, get().localStream);
              }
            }
          });
        }
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

    // Auto-unlock audio elements on user interaction (Safari/iOS policy)
    const unlockAllAudio = () => {
      Object.values(get().remoteAudioElements).forEach(audio => {
        if (audio && audio.paused) {
          audio.play().catch(() => {});
        }
      });
      const ctx = get().sharedAudioContext;
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
    };
    window.removeEventListener('click', unlockAllAudio);
    window.removeEventListener('touchstart', unlockAllAudio);
    window.addEventListener('click', unlockAllAudio, { passive: true });
    window.addEventListener('touchstart', unlockAllAudio, { passive: true });

    // Auto re-query on tab focus / visibility
    const handleVisibility = () => {
      if (!document.hidden && socket.connected) {
        const activeRoom = useRoomStore.getState().roomId || currentRoomId;
        if (activeRoom) {
          socket.emit('webrtc_get_voice_users', { roomId: activeRoom });
        }
      }
    };
    document.removeEventListener('visibilitychange', handleVisibility);
    document.addEventListener('visibilitychange', handleVisibility);

    if (currentRoomId && socket.connected) {
      socket.emit('webrtc_get_voice_users', { roomId: currentRoomId });
    }
  },

  joinVoice: async () => {
    if (get().isInVoice || get().isConnecting) return;
    set({ isConnecting: true, error: null, audioBlocked: false });

    try {
      if (!navigator?.mediaDevices?.getUserMedia) {
        throw new Error('Голосовой чат требует безопасного соединения (HTTPS)');
      }

      // Pre-unlock audio element for iOS Safari autoplay compatibility
      try {
        const dummyAudio = document.createElement('audio');
        dummyAudio.setAttribute('playsinline', '');
        dummyAudio.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        dummyAudio.play().catch(() => {});
      } catch (e) {}

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

      // 2. Get user microphone stream with audio enhancements, with fallback for strict mobile browsers
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
          },
          video: false,
        });
      } catch (e) {
        console.warn('[VOICE] Advanced mic constraints rejected, fallback to basic audio:', e);
        stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      }

      // Ensure audio tracks are enabled
      stream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });

      set({ localStream: stream });

      const socket = useRoomStore.getState().socket;
      const myUserId = String(useRoomStore.getState().userId);
      const roomId = useRoomStore.getState().roomId;
      const nickname = useRoomStore.getState().nickname;

      if (!socket || !socket.connected) {
        throw new Error('Нет подключения к серверу комнаты');
      }

      // 3. Setup WebRTC signaling socket handlers
      get().setupSignaling(socket, myUserId, stream);

      // 4. Notify server that we joined voice with explicit payload
      socket.emit('webrtc_join_voice', { roomId, userId: myUserId, nickname });

      const roomVoiceUsers = new Set(get().roomVoiceUsers);
      roomVoiceUsers.add(myUserId);

      // 5. Heartbeat to maintain voice connection even across network blips
      if (get().voiceHeartbeatInterval) {
        clearInterval(get().voiceHeartbeatInterval);
      }
      const heartbeat = setInterval(() => {
        const s = useRoomStore.getState().socket;
        const rId = useRoomStore.getState().roomId;
        const uId = useRoomStore.getState().userId;
        const nick = useRoomStore.getState().nickname;
        if (get().isInVoice && s && s.connected && rId && uId) {
          s.emit('webrtc_join_voice', { roomId: rId, userId: String(uId), nickname: nick });
        }
      }, 5000);

      set({
        isInVoice: true,
        isMuted: false,
        isConnecting: false,
        audioBlocked: false,
        voiceHeartbeatInterval: heartbeat,
        roomVoiceUsers,
        activeSpeakers: new Set([myUserId]),
      });

      // 6. Local speech activity detection
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
    const { localStream, peerConnections, remoteAudioElements, voiceHeartbeatInterval } = get();
    const socket = useRoomStore.getState().socket;
    const myUserId = String(useRoomStore.getState().userId || '');
    const roomId = useRoomStore.getState().roomId;

    if (voiceHeartbeatInterval) {
      clearInterval(voiceHeartbeatInterval);
    }

    if (socket && socket.connected && roomId) {
      socket.emit('webrtc_leave_voice', { roomId, userId: myUserId });
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

      for (const u of users) {
        if (u && u.userId) {
          const uid = String(u.userId);
          if (uid === String(myUserId)) continue;
          currentSpeakers.add(uid);
          currentRoomVoice.add(uid);

          // Deterministic initiator: the peer with higher string ID initiates offer
          const isInitiator = String(myUserId) > uid;
          const activeStream = stream || get().localStream;
          if (isInitiator && activeStream && get().isInVoice) {
            await get().createPeerConnection(uid, true, activeStream);
          }
        }
      }
      set({ activeSpeakers: currentSpeakers, roomVoiceUsers: currentRoomVoice });
    });

    // When a new peer joins voice
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

      // Deterministic initiator: the peer with higher string ID initiates offer
      const isInitiator = String(myUserId) > peerId;
      const activeStream = stream || get().localStream;
      if (isInitiator && activeStream && get().isInVoice) {
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
        const candData = signal.candidate;
        if (!candData || !candData.candidate) return;

        if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
          // Queue ICE candidate until remote description is set
          const pending = get().pendingCandidates[senderUserId] || [];
          pending.push(candData);
          set(state => ({
            pendingCandidates: { ...state.pendingCandidates, [senderUserId]: pending }
          }));
          return;
        }

        try {
          await pc.addIceCandidate(candData);
        } catch (err) {
          console.warn('[WEBRTC] addIceCandidate error:', err);
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
          const answer = await pc.createAnswer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false,
          });
          await pc.setLocalDescription(answer);

          const rId = useRoomStore.getState().roomId;
          socket.emit('webrtc_signal', {
            roomId: rId,
            senderUserId: String(myUserId),
            targetUserId: senderUserId,
            signal: {
              type: answer.type,
              sdp: answer.sdp,
            },
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
        if (cand && cand.candidate) {
          await pc.addIceCandidate(cand);
        }
      } catch (e) {
        console.warn('[WEBRTC] Error flushing queued ICE candidate:', e);
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

    // Ensure audio transceiver is registered with sendrecv for mobile browsers
    try {
      pc.addTransceiver('audio', { direction: 'sendrecv' });
    } catch (e) {}

    // Add local microphone audio tracks
    const activeStream = stream || get().localStream;
    if (activeStream) {
      activeStream.getAudioTracks().forEach(track => {
        try {
          pc.addTrack(track, activeStream);
        } catch (e) {}
      });
    }

    set(prev => ({
      peerConnectionStates: { ...prev.peerConnectionStates, [peerId]: 'connecting' }
    }));

    // Send local ICE candidates to peer
    pc.onicecandidate = (event) => {
      if (event.candidate && event.candidate.candidate && socket && socket.connected) {
        const rId = useRoomStore.getState().roomId;
        const myUid = String(useRoomStore.getState().userId);
        const candPayload = event.candidate.toJSON
          ? event.candidate.toJSON()
          : {
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
            };
        socket.emit('webrtc_signal', {
          roomId: rId,
          senderUserId: myUid,
          targetUserId: peerId,
          signal: { candidate: candPayload },
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
        audio.setAttribute('playsinline', '');
        audio.setAttribute('webkit-playsinline', '');
        audio.muted = false; // Never mute playback - allows hardware echo cancellation and loud audio
        audio.volume = 1.0;
        // Never use display: none! WebKit mutes audio elements with display: none
        audio.style.position = 'fixed';
        audio.style.top = '-9999px';
        audio.style.left = '-9999px';
        audio.style.width = '1px';
        audio.style.height = '1px';
        audio.style.opacity = '0.01';
        audio.style.pointerEvents = 'none';
        document.body.appendChild(audio);

        set(state => ({
          remoteAudioElements: { ...state.remoteAudioElements, [peerId]: audio },
        }));
      }

      audio.srcObject = remoteStream;
      audio.play().catch(e => {
        console.warn('[VOICE] Remote audio autoplay deferred, will unlock on interaction:', e);
        set({ audioBlocked: true });
      });

      // 2. WebKit Audio Bug Fix: Clone the audio track for Analyser!
      // In Safari on iOS/macOS, connecting remoteStream directly to createMediaStreamSource silences the HTMLAudioElement
      const ctx = get().sharedAudioContext;
      if (ctx) {
        try {
          if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
          }
          const clonedTrack = event.track.clone();
          const visualizerStream = new MediaStream([clonedTrack]);
          const source = ctx.createMediaStreamSource(visualizerStream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.4;
          source.connect(analyser);
          get().startSpeechVisualizerLoop(peerId, analyser, false);
        } catch (e) {
          console.warn('[VOICE] Visualizer track clone error:', e);
        }
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log(`[WEBRTC] Peer ${peerId} ICE state:`, pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`[WEBRTC] Peer ${peerId} connection state:`, state);
      set(prev => ({
        peerConnectionStates: { ...prev.peerConnectionStates, [peerId]: state }
      }));

      if (state === 'connected') {
        set({ audioBlocked: false });
        const audio = get().remoteAudioElements[peerId];
        if (audio && audio.paused) {
          audio.play().catch(() => set({ audioBlocked: true }));
        }
      } else if (state === 'failed') {
        console.warn(`[WEBRTC] Connection to peer ${peerId} failed (NAT / network), attempting ICE restart...`);
        if (isInitiator && get().isInVoice) {
          try {
            if (typeof pc.restartIce === 'function') {
              pc.restartIce();
            }
            pc.createOffer({ iceRestart: true })
              .then(offer => pc.setLocalDescription(offer))
              .then(() => {
                const rId = useRoomStore.getState().roomId;
                const myUid = String(useRoomStore.getState().userId);
                const offer = pc.localDescription;
                socket.emit('webrtc_signal', {
                  roomId: rId,
                  senderUserId: myUid,
                  targetUserId: peerId,
                  signal: { type: offer.type, sdp: offer.sdp }
                });
              })
              .catch(e => console.warn('[WEBRTC] ICE restart failed:', e));
          } catch (e) {}
        }
      }
    };

    set(state => ({
      peerConnections: { ...state.peerConnections, [peerId]: pc },
    }));

    if (isInitiator) {
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
        });
        await pc.setLocalDescription(offer);
        const rId = useRoomStore.getState().roomId;
        const myUid = String(useRoomStore.getState().userId);
        socket.emit('webrtc_signal', {
          roomId: rId,
          senderUserId: myUid,
          targetUserId: peerId,
          signal: {
            type: offer.type,
            sdp: offer.sdp,
          },
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

    const updatedStates = { ...get().peerConnectionStates };
    delete updatedStates[uid];

    set({
      peerConnections: updatedPcs,
      remoteAudioElements: updatedAudios,
      pendingCandidates: updatedPending,
      peerConnectionStates: updatedStates,
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

import { describe, it, expect, vi, beforeEach } from 'vitest';

let lastCreatedRoom = null;
let mockRoomState = null;
let cameraShouldReject = false;

// Minimal fake LiveKit Room: just enough event plumbing + localParticipant
// surface for voiceStore to drive, mirroring the FakeSocket pattern used in
// roomStore.test.js.
class FakeRoom {
  constructor() {
    this.listeners = {};
    this.localParticipant = {
      setMicrophoneEnabled: vi.fn(async () => {}),
      setCameraEnabled: vi.fn(async (enabled) => {
        if (enabled && cameraShouldReject) {
          const err = new Error('denied');
          err.name = 'NotAllowedError';
          throw err;
        }
      }),
      publishTrack: vi.fn(async () => ({ track: {} })),
      unpublishTrack: vi.fn(async () => {}),
      getTrackPublication: vi.fn(() => null),
    };
    this.remoteParticipants = new Map();
    this.disconnect = vi.fn(async () => {
      this.emit('disconnected');
    });
    lastCreatedRoom = this;
  }
  on(event, cb) {
    (this.listeners[event] ||= []).push(cb);
    return this;
  }
  off() {
    return this;
  }
  async connect() {}
  emit(event, ...args) {
    (this.listeners[event] || []).forEach(cb => cb(...args));
  }
}

vi.mock('livekit-client', () => ({
  Room: vi.fn(function (...args) {
    return new FakeRoom(...args);
  }),
  RoomEvent: {
    TrackSubscribed: 'trackSubscribed',
    TrackUnsubscribed: 'trackUnsubscribed',
    ActiveSpeakersChanged: 'activeSpeakersChanged',
    ParticipantConnected: 'participantConnected',
    ParticipantDisconnected: 'participantDisconnected',
    Disconnected: 'disconnected',
  },
  Track: {
    Kind: { Audio: 'audio', Video: 'video' },
    Source: { Camera: 'camera', ScreenShare: 'screen_share', ScreenShareAudio: 'screen_share_audio' },
  },
}));

vi.mock('./roomStore', () => ({
  useRoomStore: {
    getState: () => mockRoomState,
  },
}));

vi.mock('../components/ToastContainer', () => ({
  showToast: vi.fn(),
}));

const { useVoiceStore } = await import('./voiceStore');
const { showToast } = await import('../components/ToastContainer');

describe('voiceStore camera video chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastCreatedRoom = null;
    cameraShouldReject = false;
    mockRoomState = {
      userId: 'user1',
      roomId: 'room1',
      nickname: 'Alice',
      members: [
        { userId: 'user1', nickname: 'Alice' },
        { userId: 'user2', nickname: 'Bob' },
      ],
      roomState: { videoType: 'youtube', videoOwnerId: null },
      socket: null,
    };
    useVoiceStore.setState({
      isInVoice: false,
      isScreenSharing: false,
      isWatchingStream: false,
      isStreamConnecting: false,
      isCameraOn: false,
      isCameraConnecting: false,
      livekitRoom: null,
      remoteVideoTrack: null,
      remoteVideoOwnerId: null,
      remoteCameraTracks: {},
      remoteAudioElements: {},
      talkingUsers: new Set(),
      peerConnectionStates: {},
      roomVoiceUsers: new Set(),
    });
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ token: 'tok', serverUrl: 'wss://fake.livekit' }),
    }));
  });

  it('connects to LiveKit and enables the camera on toggleCamera', async () => {
    await useVoiceStore.getState().toggleCamera();

    expect(useVoiceStore.getState().isCameraOn).toBe(true);
    expect(useVoiceStore.getState().isCameraConnecting).toBe(false);
    expect(lastCreatedRoom.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true);
  });

  it('disables the camera and disconnects LiveKit when nothing else needs it', async () => {
    await useVoiceStore.getState().toggleCamera(); // on
    await useVoiceStore.getState().toggleCamera(); // off

    expect(useVoiceStore.getState().isCameraOn).toBe(false);
    expect(lastCreatedRoom.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(false);
    expect(lastCreatedRoom.disconnect).toHaveBeenCalled();
    expect(useVoiceStore.getState().livekitRoom).toBeNull();
  });

  it('keeps the LiveKit connection alive if voice chat is still active when camera turns off', async () => {
    useVoiceStore.setState({ isInVoice: true });
    await useVoiceStore.getState().toggleCamera(); // on
    await useVoiceStore.getState().toggleCamera(); // off

    expect(useVoiceStore.getState().isCameraOn).toBe(false);
    expect(lastCreatedRoom.disconnect).not.toHaveBeenCalled();
  });

  it('turns off the camera when leaving voice chat and disconnects if nothing else needs the connection', async () => {
    await useVoiceStore.getState().joinVoice();
    await useVoiceStore.getState().toggleCamera();
    expect(useVoiceStore.getState().isCameraOn).toBe(true);

    await useVoiceStore.getState().leaveVoice();

    expect(useVoiceStore.getState().isInVoice).toBe(false);
    expect(useVoiceStore.getState().isCameraOn).toBe(false);
    expect(lastCreatedRoom.localParticipant.setCameraEnabled).toHaveBeenLastCalledWith(false);
    expect(lastCreatedRoom.disconnect).toHaveBeenCalled();
  });

  it('keeps the LiveKit connection alive on leaveVoice if screen sharing is still active', async () => {
    await useVoiceStore.getState().joinVoice();
    useVoiceStore.setState({ isScreenSharing: true });

    await useVoiceStore.getState().leaveVoice();

    expect(useVoiceStore.getState().isInVoice).toBe(false);
    expect(lastCreatedRoom.disconnect).not.toHaveBeenCalled();
  });

  it('routes a Camera-source track to remoteCameraTracks and a ScreenShare-source track to remoteVideoTrack', async () => {
    await useVoiceStore.getState().toggleCamera();

    const fakeCameraTrack = { kind: 'video' };
    lastCreatedRoom.emit('trackSubscribed', fakeCameraTrack, { source: 'camera' }, { identity: 'user2' });

    expect(useVoiceStore.getState().remoteCameraTracks['user2']).toBe(fakeCameraTrack);
    expect(useVoiceStore.getState().remoteVideoTrack).toBeNull();

    const fakeScreenTrack = { kind: 'video' };
    lastCreatedRoom.emit('trackSubscribed', fakeScreenTrack, { source: 'screen_share' }, { identity: 'user2' });

    expect(useVoiceStore.getState().remoteVideoTrack).toBe(fakeScreenTrack);
    expect(useVoiceStore.getState().remoteVideoOwnerId).toBe('user2');
    // Screen-share track must not have been misrouted into the camera map.
    expect(useVoiceStore.getState().remoteCameraTracks['user2']).toBe(fakeCameraTrack);
  });

  it('removes a camera track on trackUnsubscribed', async () => {
    await useVoiceStore.getState().toggleCamera();
    const fakeTrack = { kind: 'video', detach: vi.fn() };
    lastCreatedRoom.emit('trackSubscribed', fakeTrack, { source: 'camera' }, { identity: 'user2' });
    expect(useVoiceStore.getState().remoteCameraTracks['user2']).toBe(fakeTrack);

    lastCreatedRoom.emit('trackUnsubscribed', fakeTrack, { source: 'camera' }, { identity: 'user2' });

    expect(fakeTrack.detach).toHaveBeenCalled();
    expect(useVoiceStore.getState().remoteCameraTracks['user2']).toBeUndefined();
  });

  it('clears a participant camera track when they disconnect', async () => {
    await useVoiceStore.getState().toggleCamera();
    const fakeTrack = { kind: 'video' };
    lastCreatedRoom.emit('trackSubscribed', fakeTrack, { source: 'camera' }, { identity: 'user2' });
    expect(useVoiceStore.getState().remoteCameraTracks['user2']).toBe(fakeTrack);

    lastCreatedRoom.emit('participantDisconnected', { identity: 'user2' });

    expect(useVoiceStore.getState().remoteCameraTracks['user2']).toBeUndefined();
  });

  it('shows a toast and does not enable the camera when getUserMedia is denied', async () => {
    cameraShouldReject = true;

    await useVoiceStore.getState().toggleCamera();

    expect(useVoiceStore.getState().isCameraOn).toBe(false);
    expect(useVoiceStore.getState().isCameraConnecting).toBe(false);
    expect(showToast).toHaveBeenCalledWith('Доступ к камере заблокирован в браузере', 'error');
  });
});

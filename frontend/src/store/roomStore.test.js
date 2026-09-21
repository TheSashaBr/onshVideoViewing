import { describe, it, expect, vi, beforeEach } from 'vitest';

// Minimal fake socket.io-client socket: just enough event plumbing for the
// store to attach listeners and for tests to simulate server messages.
class FakeSocket {
  constructor() {
    this.listeners = {};
    this.emitted = [];
  }
  on(event, cb) {
    (this.listeners[event] ||= []).push(cb);
    return this;
  }
  emit(event, payload) {
    this.emitted.push({ event, payload });
    return this;
  }
  disconnect() {}
  // Test helper: simulate the server sending an event to this socket.
  trigger(event, payload) {
    (this.listeners[event] || []).forEach(cb => cb(payload));
  }
}

let lastCreatedSocket = null;

vi.mock('socket.io-client', () => ({
  default: vi.fn(() => {
    lastCreatedSocket = new FakeSocket();
    return lastCreatedSocket;
  }),
}));

vi.mock('./voiceStore', () => ({
  useVoiceStore: {
    getState: () => ({
      initVoiceRoomListeners: vi.fn(),
      isInVoice: false,
    }),
  },
}));

vi.mock('../components/ToastContainer', () => ({
  showToast: vi.fn(),
}));

const { useRoomStore } = await import('./roomStore');
const { showToast } = await import('../components/ToastContainer');

function joinAndGetSocket(isHost = false) {
  useRoomStore.getState().joinRoom('room1', 'user1', 'Alice', isHost);
  return lastCreatedSocket;
}

describe('roomStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRoomStore.getState().leaveRoom();
  });

  it('emits join_room and sets optimistic local state', () => {
    const socket = joinAndGetSocket(false);
    expect(socket.emitted[0]).toEqual({
      event: 'join_room',
      payload: { roomId: 'room1', userId: 'user1', nickname: 'Alice', isHost: false },
    });
    expect(useRoomStore.getState().roomId).toBe('room1');
    expect(useRoomStore.getState().userId).toBe('user1');
  });

  it('applies the server-verified isHost from SYNC_STATE and never leaks it into roomState', () => {
    const socket = joinAndGetSocket(false); // client optimistically claims non-host
    socket.trigger('message', {
      type: 'SYNC_STATE',
      roomId: 'room1',
      senderId: 'SERVER',
      timestamp: Date.now(),
      payload: { currentTime: 12, isPlaying: true, playbackRate: 1, controlMode: 'anyone', isHost: true },
    });

    const state = useRoomStore.getState();
    expect(state.isHost).toBe(true); // server corrected it
    expect(state.roomState.currentTime).toBe(12);
    expect(state.roomState.isHost).toBeUndefined(); // must not pollute roomState
  });

  it('updates roomState on PLAY/PAUSE/SEEK from another sender', () => {
    const socket = joinAndGetSocket(false);

    socket.trigger('message', {
      type: 'PLAY',
      roomId: 'room1',
      senderId: 'user2',
      timestamp: Date.now(),
      payload: { position: 42 },
    });
    expect(useRoomStore.getState().roomState.isPlaying).toBe(true);
    expect(useRoomStore.getState().roomState.currentTime).toBe(42);

    socket.trigger('message', {
      type: 'PAUSE',
      roomId: 'room1',
      senderId: 'user2',
      timestamp: Date.now(),
      payload: { position: 50 },
    });
    expect(useRoomStore.getState().roomState.isPlaying).toBe(false);
    expect(useRoomStore.getState().roomState.currentTime).toBe(50);
  });

  it('applies CONTROL_MODE_CHANGED and toasts other users but not the sender themselves', () => {
    const socket = joinAndGetSocket(true);

    // Broadcast echoed back to the host who made the change (senderId === own userId)
    socket.trigger('message', {
      type: 'CONTROL_MODE_CHANGED',
      roomId: 'room1',
      senderId: 'user1',
      timestamp: Date.now(),
      payload: { controlMode: 'host' },
    });
    expect(useRoomStore.getState().roomState.controlMode).toBe('host');
    expect(showToast).not.toHaveBeenCalled();

    // Same change observed by a different member
    socket.trigger('message', {
      type: 'CONTROL_MODE_CHANGED',
      roomId: 'room1',
      senderId: 'someone-else',
      timestamp: Date.now(),
      payload: { controlMode: 'anyone' },
    });
    expect(useRoomStore.getState().roomState.controlMode).toBe('anyone');
    expect(showToast).toHaveBeenCalled();
  });

  it('promotes the local user on HOST_CHANGED when they are the new host', () => {
    const socket = joinAndGetSocket(false);

    socket.trigger('message', {
      type: 'HOST_CHANGED',
      roomId: 'room1',
      senderId: 'SERVER',
      timestamp: Date.now(),
      payload: {
        newHostId: 'user1',
        newHostNickname: 'Alice',
        members: [{ userId: 'user1', nickname: 'Alice', isHost: true, joinedAt: Date.now() }],
      },
    });

    expect(useRoomStore.getState().isHost).toBe(true);
  });

  it('demotes the local user on HOST_CHANGED when someone else becomes host', () => {
    const socket = joinAndGetSocket(true); // was optimistically host

    socket.trigger('message', {
      type: 'HOST_CHANGED',
      roomId: 'room1',
      senderId: 'SERVER',
      timestamp: Date.now(),
      payload: {
        newHostId: 'user2',
        newHostNickname: 'Bob',
        members: [
          { userId: 'user1', nickname: 'Alice', isHost: false, joinedAt: Date.now() },
          { userId: 'user2', nickname: 'Bob', isHost: true, joinedAt: Date.now() },
        ],
      },
    });

    expect(useRoomStore.getState().isHost).toBe(false);
  });
});

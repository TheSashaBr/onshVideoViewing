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

  it('replaces the queue on QUEUE_STATE', () => {
    const socket = joinAndGetSocket(true);

    const queue = [
      { id: 'a', url: 'https://youtu.be/aaaaaaaaaaa', videoType: 'youtube', addedBy: 'user2', nickname: 'Bob', addedAt: Date.now() },
      { id: 'b', url: 'https://youtu.be/bbbbbbbbbbb', videoType: 'youtube', addedBy: 'user1', nickname: 'Alice', addedAt: Date.now() },
    ];

    socket.trigger('message', {
      type: 'QUEUE_STATE',
      roomId: 'room1',
      senderId: 'SERVER',
      timestamp: Date.now(),
      payload: { queue },
    });

    expect(useRoomStore.getState().queue).toEqual(queue);

    // An empty/malformed payload clears the queue rather than crashing.
    socket.trigger('message', {
      type: 'QUEUE_STATE',
      roomId: 'room1',
      senderId: 'SERVER',
      timestamp: Date.now(),
      payload: {},
    });
    expect(useRoomStore.getState().queue).toEqual([]);
  });

  it('emits QUEUE_ADD/QUEUE_REMOVE/QUEUE_NEXT via addToQueue/removeFromQueue/playNextFromQueue', () => {
    const socket = joinAndGetSocket(true);
    socket.emitted.length = 0; // ignore the initial join_room emit

    useRoomStore.getState().addToQueue('https://youtu.be/aaaaaaaaaaa', 'youtube');
    useRoomStore.getState().removeFromQueue('item-1');
    useRoomStore.getState().playNextFromQueue();

    const types = socket.emitted.map(e => e.payload.type);
    expect(types).toEqual(['QUEUE_ADD', 'QUEUE_REMOVE', 'QUEUE_NEXT']);
    expect(socket.emitted[0].payload.payload).toMatchObject({ url: 'https://youtu.be/aaaaaaaaaaa', videoType: 'youtube' });
    expect(socket.emitted[1].payload.payload).toEqual({ itemId: 'item-1' });
  });

  it('sets lastReaction on an incoming VIDEO_REACTION and when sending one locally', () => {
    const socket = joinAndGetSocket(false);

    socket.trigger('message', {
      type: 'VIDEO_REACTION',
      roomId: 'room1',
      senderId: 'user2',
      timestamp: Date.now(),
      payload: { emoji: '🔥' },
    });
    expect(useRoomStore.getState().lastReaction).toMatchObject({ emoji: '🔥', senderId: 'user2' });

    socket.emitted.length = 0;
    useRoomStore.getState().sendReaction('🎬');
    expect(socket.emitted[0].payload).toMatchObject({ type: 'VIDEO_REACTION', payload: { emoji: '🎬' } });
    expect(useRoomStore.getState().lastReaction).toMatchObject({ emoji: '🎬', senderId: 'user1' });
  });

  it('sets joinError on join_denied and surfaces a toast', () => {
    const socket = joinAndGetSocket(false);

    socket.trigger('join_denied', { reason: 'password' });

    const state = useRoomStore.getState();
    expect(state.joinError).toBe('password');
    expect(state.isJoining).toBe(false);
    expect(state.hasJoinedRoom).toBe(false);
    expect(showToast).toHaveBeenCalled();
  });

  it('includes the password in join_room and re-sends it on reconnect', () => {
    useRoomStore.getState().joinRoom('room1', 'user1', 'Alice', false, 'sekret');
    const socket = lastCreatedSocket;

    expect(socket.emitted[0].payload).toMatchObject({ password: 'sekret' });

    socket.emitted.length = 0;
    socket.trigger('connect');
    expect(socket.emitted[0].payload).toMatchObject({ password: 'sekret' });
  });

  it('tracks videoOwnerId from LOAD_VIDEO and clears it when the video is cleared', () => {
    const socket = joinAndGetSocket(false);

    socket.trigger('message', {
      type: 'LOAD_VIDEO',
      roomId: 'room1',
      senderId: 'user2',
      timestamp: Date.now(),
      payload: { videoUrl: 'local-stream', videoType: 'local-stream' },
    });
    expect(useRoomStore.getState().roomState.videoOwnerId).toBe('user2');

    socket.trigger('message', {
      type: 'LOAD_VIDEO',
      roomId: 'room1',
      senderId: 'user2',
      timestamp: Date.now(),
      payload: { videoUrl: '', videoType: 'youtube' },
    });
    expect(useRoomStore.getState().roomState.videoOwnerId).toBeNull();
  });

  it('sets videoOwnerId to the local user when loadVideo is called optimistically', () => {
    joinAndGetSocket(false);
    useRoomStore.getState().loadVideo('local-stream', 'local-stream');
    expect(useRoomStore.getState().roomState.videoOwnerId).toBe('user1');

    useRoomStore.getState().loadVideo('', 'youtube');
    expect(useRoomStore.getState().roomState.videoOwnerId).toBeNull();
  });

  it('carries replyTo through an incoming CHAT_MESSAGE', () => {
    const socket = joinAndGetSocket(false);

    socket.trigger('message', {
      type: 'CHAT_MESSAGE',
      roomId: 'room1',
      senderId: 'user2',
      timestamp: Date.now(),
      payload: {
        id: 'msg-2',
        nickname: 'Bob',
        text: 'Согласен!',
        replyTo: { id: 'msg-1', nickname: 'Alice', text: 'Го смотреть?' },
      },
    });

    const messages = useRoomStore.getState().chatMessages;
    const last = messages[messages.length - 1];
    expect(last).toMatchObject({
      id: 'msg-2',
      userId: 'user2',
      text: 'Согласен!',
      replyTo: { id: 'msg-1', nickname: 'Alice', text: 'Го смотреть?' },
    });
  });

  it('includes replyTo when sending a chat message locally', () => {
    const socket = joinAndGetSocket(false);
    socket.emitted.length = 0;

    useRoomStore.getState().sendChat('Го!', { id: 'msg-1', nickname: 'Alice', text: 'Го смотреть?' });

    expect(socket.emitted[0].payload.payload).toMatchObject({
      text: 'Го!',
      replyTo: { id: 'msg-1', nickname: 'Alice', text: 'Го смотреть?' },
    });
    const messages = useRoomStore.getState().chatMessages;
    expect(messages[messages.length - 1].replyTo).toEqual({ id: 'msg-1', nickname: 'Alice', text: 'Го смотреть?' });
  });

  describe('shorts feed', () => {
    const feedState = (payload) => ({ type: 'FEED_STATE', roomId: 'room1', senderId: 'SERVER', timestamp: Date.now(), payload });

    it('applies FEED_STATE and resets it when the feed ends', () => {
      const socket = joinAndGetSocket(false);
      socket.trigger('message', feedState({
        active: true, label: 'Мемы', index: 2, total: 50, hasMore: true,
        current: { id: 'abcdefghijk', title: 'Кот', channel: 'Канал' },
      }));
      expect(useRoomStore.getState().feed).toMatchObject({ active: true, label: 'Мемы', index: 2 });

      socket.trigger('message', feedState({ active: false }));
      expect(useRoomStore.getState().feed).toEqual({ active: false });
    });

    it('sends FEED_NEXT/FEED_PREV with the index the user was looking at', () => {
      const socket = joinAndGetSocket(false);
      socket.trigger('message', feedState({ active: true, label: 'Мемы', index: 3, total: 50, current: null }));
      socket.emitted.length = 0;

      useRoomStore.getState().feedNext();
      useRoomStore.getState().feedPrev();

      expect(socket.emitted.map(e => [e.payload.type, e.payload.payload])).toEqual([
        ['FEED_NEXT', { fromIndex: 3 }],
        ['FEED_PREV', { fromIndex: 3 }],
      ]);
    });

    it('does not send FEED_PREV from the first item or feed actions when no feed is active', () => {
      const socket = joinAndGetSocket(false);
      socket.emitted.length = 0;
      useRoomStore.getState().feedNext(); // no feed yet

      socket.trigger('message', feedState({ active: true, label: 'Мемы', index: 0, total: 50, current: null }));
      useRoomStore.getState().feedPrev();

      expect(socket.emitted).toEqual([]);
    });

    it('starts a feed by preset topic or by free-text query', () => {
      const socket = joinAndGetSocket(true);
      socket.emitted.length = 0;

      useRoomStore.getState().startFeed({ topic: 'memes' });
      useRoomStore.getState().startFeed({ query: 'котики' });

      expect(socket.emitted.map(e => e.payload.payload)).toEqual([{ topic: 'memes' }, { query: 'котики' }]);
    });

    it('explains a feed_error to the user', () => {
      const socket = joinAndGetSocket(true);
      socket.trigger('feed_error', { reason: 'config' });
      expect(showToast).toHaveBeenCalledWith(expect.stringContaining('ключ YouTube API'), 'warning', 4000);
    });
  });
});

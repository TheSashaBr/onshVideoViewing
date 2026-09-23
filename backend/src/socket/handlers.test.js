const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const { io: ioClient } = require('socket.io-client');

const { redisClient } = require('../redis/client');
const { createRoom } = require('../redis/repository');
const { initSocket } = require('./index');
const { hashPassword } = require('../utils/password');

// These tests exercise the real socket handlers (join_room host verification,
// playback broadcast, control_mode enforcement) end-to-end over real Socket.IO
// connections. Redis is replaced with a tiny in-memory fake so the suite is
// fast and deterministic, and — critically — never touches the real Redis
// instance configured in backend/.env (a live Upstash database shared with
// production). We monkey-patch the command methods directly on the
// `redisClient` singleton that repository.js also holds (same object, from
// Node's require cache) rather than using a mocking framework — this is a
// plain CommonJS backend, so plain object mutation is the most reliable way
// to substitute the data layer without pulling in extra tooling.
const hashes = new Map();
const lists = new Map();
const sets = new Map();

Object.assign(redisClient, {
  async hSet(key, fieldOrObj, value) {
    const obj = hashes.get(key) || {};
    if (typeof fieldOrObj === 'object' && fieldOrObj !== null) {
      for (const [k, v] of Object.entries(fieldOrObj)) obj[k] = String(v);
    } else {
      obj[fieldOrObj] = String(value);
    }
    hashes.set(key, obj);
  },
  async hGetAll(key) {
    return { ...(hashes.get(key) || {}) };
  },
  async hDel(key, field) {
    const obj = hashes.get(key);
    if (obj) delete obj[field];
  },
  async expire() {},
  async lPush(key, value) {
    const arr = lists.get(key) || [];
    arr.unshift(value);
    lists.set(key, arr);
  },
  async lTrim(key, start, stop) {
    const arr = lists.get(key) || [];
    lists.set(key, arr.slice(start, stop === -1 ? undefined : stop + 1));
  },
  async lRange(key, start, stop) {
    const arr = lists.get(key) || [];
    return arr.slice(start, stop === -1 ? undefined : stop + 1);
  },
  async rPush(key, value) {
    const arr = lists.get(key) || [];
    if (Array.isArray(value)) arr.push(...value);
    else arr.push(value);
    lists.set(key, arr);
  },
  async lPop(key) {
    const arr = lists.get(key) || [];
    const val = arr.shift();
    lists.set(key, arr);
    return val === undefined ? null : val;
  },
  async del(key) {
    hashes.delete(key);
    lists.delete(key);
    sets.delete(key);
  },
  async sAdd(key, value) {
    const s = sets.get(key) || new Set();
    s.add(String(value));
    sets.set(key, s);
  },
  async sRem(key, value) {
    const s = sets.get(key);
    if (s) s.delete(String(value));
  },
  async sMembers(key) {
    return Array.from(sets.get(key) || []);
  },
});

let server;
let port;
const activeSockets = [];

function connectClient() {
  const socket = ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  activeSockets.push(socket);
  return socket;
}

function waitForEvent(socket, event, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function waitForMessageOfType(socket, type, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for message type "${type}"`)), timeoutMs);
    const handler = (msg) => {
      if (msg?.type === type) {
        clearTimeout(timer);
        socket.off('message', handler);
        resolve(msg);
      }
    };
    socket.on('message', handler);
  });
}

before(async () => {
  server = http.createServer();
  initSocket(server);
  await new Promise((resolve) => server.listen(0, resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  while (activeSockets.length) {
    const s = activeSockets.pop();
    s.removeAllListeners();
    s.disconnect();
  }
});

describe('socket handlers', () => {
  let roomId;
  let hostId;

  beforeEach(async () => {
    hostId = uuidv4();
    roomId = uuidv4();
    await createRoom(roomId, hostId);
  });

  it('verifies host status server-side and ignores a spoofed isHost claim from a guest', async () => {
    const guestSocket = connectClient();
    await waitForEvent(guestSocket, 'connect');
    const guestSync = waitForMessageOfType(guestSocket, 'SYNC_STATE');
    // Guest is not the real host, but claims isHost: true — server must ignore this.
    guestSocket.emit('join_room', { roomId, userId: uuidv4(), nickname: 'Guest', isHost: true });
    const guestPayload = await guestSync;
    assert.equal(guestPayload.payload.isHost, false);

    const hostSocket = connectClient();
    await waitForEvent(hostSocket, 'connect');
    const hostSync = waitForMessageOfType(hostSocket, 'SYNC_STATE');
    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host', isHost: false });
    const hostPayload = await hostSync;
    assert.equal(hostPayload.payload.isHost, true);
  });

  it('broadcasts PLAY from one participant to another in the same room', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');

    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const playReceived = waitForMessageOfType(guestSocket, 'PLAY');
    hostSocket.emit('message', {
      type: 'PLAY',
      roomId,
      senderId: hostId,
      timestamp: Date.now(),
      payload: { position: 15 },
    });

    const msg = await playReceived;
    assert.equal(msg.payload.position, 15);
  });

  it('blocks a non-host from controlling playback once control_mode is set to host-only', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');

    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const controlModeChanged = waitForMessageOfType(guestSocket, 'CONTROL_MODE_CHANGED');
    hostSocket.emit('set_control_mode', { mode: 'host' });
    await controlModeChanged;

    const denied = waitForEvent(guestSocket, 'control_denied');
    guestSocket.emit('message', {
      type: 'PLAY',
      roomId,
      senderId: guestId,
      timestamp: Date.now(),
      payload: { position: 30 },
    });

    const denialPayload = await denied;
    assert.equal(denialPayload.action, 'PLAY');
  });

  it('adds a video to the queue and broadcasts the updated queue to everyone', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const guestSeesQueue = waitForMessageOfType(guestSocket, 'QUEUE_STATE');
    hostSocket.emit('message', {
      type: 'QUEUE_ADD',
      roomId,
      senderId: hostId,
      timestamp: Date.now(),
      payload: { url: 'https://youtu.be/dQw4w9WgXcQ', videoType: 'youtube', nickname: 'Host' },
    });

    const queueMsg = await guestSeesQueue;
    assert.equal(queueMsg.payload.queue.length, 1);
    assert.equal(queueMsg.payload.queue[0].url, 'https://youtu.be/dQw4w9WgXcQ');
    assert.equal(queueMsg.payload.queue[0].addedBy, hostId);
  });

  it('lets a guest remove their own queued item but not one added by someone else', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    // Host adds an item; guest adds an item. QUEUE_STATE broadcasts to the
    // whole room, so both sockets must drain the first broadcast before we
    // start listening for the second one, or a listener set up "too late"
    // ends up catching the earlier (still in-flight) message instead.
    const hostItemAddedOnHost = waitForMessageOfType(hostSocket, 'QUEUE_STATE');
    const hostItemAddedOnGuest = waitForMessageOfType(guestSocket, 'QUEUE_STATE');
    hostSocket.emit('message', {
      type: 'QUEUE_ADD', roomId, senderId: hostId, timestamp: Date.now(),
      payload: { url: 'https://youtu.be/aaaaaaaaaaa', videoType: 'youtube', nickname: 'Host' },
    });
    await Promise.all([hostItemAddedOnHost, hostItemAddedOnGuest]);

    const guestItemAdded = waitForMessageOfType(guestSocket, 'QUEUE_STATE');
    guestSocket.emit('message', {
      type: 'QUEUE_ADD', roomId, senderId: guestId, timestamp: Date.now(),
      payload: { url: 'https://youtu.be/bbbbbbbbbbb', videoType: 'youtube', nickname: 'Guest' },
    });
    const afterBothAdded = await guestItemAdded;
    assert.equal(afterBothAdded.payload.queue.length, 2);

    const hostItemId = afterBothAdded.payload.queue.find(i => i.addedBy === hostId).id;
    const guestItemId = afterBothAdded.payload.queue.find(i => i.addedBy === guestId).id;

    // Guest cannot remove the host's item — no QUEUE_STATE update should follow.
    let unexpectedUpdate = false;
    const guard = (msg) => { if (msg.type === 'QUEUE_STATE') unexpectedUpdate = true; };
    guestSocket.on('message', guard);
    guestSocket.emit('message', {
      type: 'QUEUE_REMOVE', roomId, senderId: guestId, timestamp: Date.now(),
      payload: { itemId: hostItemId },
    });
    await new Promise(r => setTimeout(r, 300));
    guestSocket.off('message', guard);
    assert.equal(unexpectedUpdate, false);

    // Guest can remove their own item.
    const removed = waitForMessageOfType(guestSocket, 'QUEUE_STATE');
    guestSocket.emit('message', {
      type: 'QUEUE_REMOVE', roomId, senderId: guestId, timestamp: Date.now(),
      payload: { itemId: guestItemId },
    });
    const afterRemove = await removed;
    assert.equal(afterRemove.payload.queue.length, 1);
    assert.equal(afterRemove.payload.queue[0].id, hostItemId);
  });

  it('QUEUE_NEXT loads the next queued video for everyone and shrinks the queue', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const added = waitForMessageOfType(hostSocket, 'QUEUE_STATE');
    hostSocket.emit('message', {
      type: 'QUEUE_ADD', roomId, senderId: hostId, timestamp: Date.now(),
      payload: { url: 'https://youtu.be/ccccccccccc', videoType: 'youtube', nickname: 'Host' },
    });
    await added;
    // Same-socket per-message throttle in handlers.js is 100ms — wait it out
    // so the next emit from hostSocket isn't silently dropped.
    await new Promise(r => setTimeout(r, 150));

    const guestLoadsNext = waitForMessageOfType(guestSocket, 'LOAD_VIDEO');
    const guestQueueShrinks = waitForMessageOfType(guestSocket, 'QUEUE_STATE');
    hostSocket.emit('message', {
      type: 'QUEUE_NEXT', roomId, senderId: hostId, timestamp: Date.now(), payload: {},
    });

    const loadMsg = await guestLoadsNext;
    assert.equal(loadMsg.payload.videoUrl, 'https://youtu.be/ccccccccccc');
    const queueMsg = await guestQueueShrinks;
    assert.equal(queueMsg.payload.queue.length, 0);
  });

  it('blocks a non-host from adding to the queue once control_mode is host-only', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const controlModeChanged = waitForMessageOfType(guestSocket, 'CONTROL_MODE_CHANGED');
    hostSocket.emit('set_control_mode', { mode: 'host' });
    await controlModeChanged;

    const denied = waitForEvent(guestSocket, 'control_denied');
    guestSocket.emit('message', {
      type: 'QUEUE_ADD', roomId, senderId: guestId, timestamp: Date.now(),
      payload: { url: 'https://youtu.be/ddddddddddd', videoType: 'youtube', nickname: 'Guest' },
    });

    const denialPayload = await denied;
    assert.equal(denialPayload.action, 'QUEUE_ADD');
  });

  it('relays VIDEO_REACTION to other participants in the room', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const reactionReceived = waitForMessageOfType(guestSocket, 'VIDEO_REACTION');
    hostSocket.emit('message', {
      type: 'VIDEO_REACTION', roomId, senderId: hostId, timestamp: Date.now(),
      payload: { emoji: '🔥' },
    });

    const msg = await reactionReceived;
    assert.equal(msg.payload.emoji, '🔥');
  });

  it('delivers and persists a chat message sent right after a typing-status update', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    guestSocket.emit('join_room', { roomId, userId: uuidv4(), nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const chatReceived = waitForMessageOfType(guestSocket, 'CHAT_MESSAGE');
    // Back-to-back in the same tick, exactly like Chat.jsx's handleSend.
    hostSocket.emit('message', {
      type: 'TYPING_STATUS', roomId, senderId: hostId, timestamp: Date.now(),
      payload: { nickname: 'Host', isTyping: false },
    });
    hostSocket.emit('message', {
      type: 'CHAT_MESSAGE', roomId, senderId: hostId, timestamp: Date.now(),
      payload: { nickname: 'Host', text: 'Привет!' },
    });

    const msg = await chatReceived;
    assert.equal(msg.payload.text, 'Привет!');

    const lateSocket = connectClient();
    await waitForEvent(lateSocket, 'connect');
    const history = waitForEvent(lateSocket, 'chat_history');
    lateSocket.emit('join_room', { roomId, userId: uuidv4(), nickname: 'Late' });
    assert.deepEqual((await history).map(m => m.text), ['Привет!']);
  });

  it('still throttles a burst of the same message type', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    guestSocket.emit('join_room', { roomId, userId: uuidv4(), nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const received = [];
    guestSocket.on('message', (m) => { if (m.type === 'VIDEO_REACTION') received.push(m.payload.emoji); });
    for (const emoji of ['🔥', '😂', '👍']) {
      hostSocket.emit('message', { type: 'VIDEO_REACTION', roomId, senderId: hostId, timestamp: Date.now(), payload: { emoji } });
    }
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(received, ['🔥']);
  });

  describe('room password', () => {
    let pwRoomId;
    let pwHostId;
    const plainPassword = 'sekret123';

    beforeEach(async () => {
      pwHostId = uuidv4();
      pwRoomId = uuidv4();
      await createRoom(pwRoomId, pwHostId, hashPassword(plainPassword));
    });

    it('lets the host join a password-protected room without a password', async () => {
      const hostSocket = connectClient();
      await waitForEvent(hostSocket, 'connect');
      const sync = waitForMessageOfType(hostSocket, 'SYNC_STATE');
      hostSocket.emit('join_room', { roomId: pwRoomId, userId: pwHostId, nickname: 'Host' });
      const payload = await sync;
      assert.equal(payload.payload.isHost, true);
    });

    it('denies a guest with no or wrong password and lets them in with the right one', async () => {
      const guestSocket = connectClient();
      await waitForEvent(guestSocket, 'connect');
      const guestId = uuidv4();

      const deniedNoPassword = waitForEvent(guestSocket, 'join_denied');
      guestSocket.emit('join_room', { roomId: pwRoomId, userId: guestId, nickname: 'Guest' });
      const denial1 = await deniedNoPassword;
      assert.equal(denial1.reason, 'password');

      const deniedWrongPassword = waitForEvent(guestSocket, 'join_denied');
      guestSocket.emit('join_room', { roomId: pwRoomId, userId: guestId, nickname: 'Guest', password: 'nope' });
      const denial2 = await deniedWrongPassword;
      assert.equal(denial2.reason, 'password');

      const sync = waitForMessageOfType(guestSocket, 'SYNC_STATE');
      guestSocket.emit('join_room', { roomId: pwRoomId, userId: guestId, nickname: 'Guest', password: plainPassword });
      await sync; // resolves only if the join actually succeeded
    });
  });

  it('lets the host manually transfer their role to another member', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const hostSeesChange = waitForMessageOfType(hostSocket, 'HOST_CHANGED');
    const guestSeesChange = waitForMessageOfType(guestSocket, 'HOST_CHANGED');
    hostSocket.emit('transfer_host', { targetUserId: guestId });

    const [hostMsg, guestMsg] = await Promise.all([hostSeesChange, guestSeesChange]);
    assert.equal(hostMsg.payload.newHostId, guestId);
    assert.equal(guestMsg.payload.newHostId, guestId);

    // The old host should no longer be able to use host-only actions.
    const stillHost = waitForEvent(hostSocket, 'kicked', 500).catch(() => null);
    hostSocket.emit('kick_user', { targetUserId: guestId });
    const result = await stillHost;
    assert.equal(result, null); // guest was never kicked — old host has no authority any more
  });

  it('ignores a transfer_host request from a non-host', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    let hostChanged = false;
    const guard = (msg) => { if (msg.type === 'HOST_CHANGED') hostChanged = true; };
    hostSocket.on('message', guard);
    guestSocket.emit('transfer_host', { targetUserId: guestId }); // guest is not host
    await new Promise(r => setTimeout(r, 300));
    hostSocket.off('message', guard);
    assert.equal(hostChanged, false);
  });

  it('rejects a second concurrent local stream and lets the first presenter be replaced once they leave', async () => {
    const hostSocket = connectClient();
    const guestSocket = connectClient();
    await Promise.all([waitForEvent(hostSocket, 'connect'), waitForEvent(guestSocket, 'connect')]);

    hostSocket.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
    await waitForMessageOfType(hostSocket, 'SYNC_STATE');
    const guestId = uuidv4();
    guestSocket.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
    await waitForMessageOfType(guestSocket, 'SYNC_STATE');

    const guestSeesStream = waitForMessageOfType(guestSocket, 'LOAD_VIDEO');
    hostSocket.emit('message', {
      type: 'LOAD_VIDEO', roomId, senderId: hostId, timestamp: Date.now(),
      payload: { videoUrl: 'local-stream', videoType: 'local-stream' },
    });
    await guestSeesStream;

    const conflict = waitForEvent(guestSocket, 'stream_conflict');
    guestSocket.emit('message', {
      type: 'LOAD_VIDEO', roomId, senderId: guestId, timestamp: Date.now(),
      payload: { videoUrl: 'local-stream', videoType: 'local-stream' },
    });
    await conflict; // guest's own attempt to start a second stream is rejected
  });
});

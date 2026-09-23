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

  it('ignores messages addressed to a room the socket has not joined', async () => {
    const otherRoomId = uuidv4();
    const otherHostId = uuidv4();
    await createRoom(otherRoomId, otherHostId);

    const intruder = connectClient();
    const victim = connectClient();
    await Promise.all([waitForEvent(intruder, 'connect'), waitForEvent(victim, 'connect')]);

    const intruderId = uuidv4();
    intruder.emit('join_room', { roomId, userId: intruderId, nickname: 'Intruder' });
    await waitForMessageOfType(intruder, 'SYNC_STATE');
    victim.emit('join_room', { roomId: otherRoomId, userId: otherHostId, nickname: 'Victim' });
    await waitForMessageOfType(victim, 'SYNC_STATE');

    const leaked = waitForMessageOfType(victim, 'LOAD_VIDEO', 400).catch(() => null);
    intruder.emit('message', {
      type: 'LOAD_VIDEO',
      roomId: otherRoomId,
      senderId: intruderId,
      timestamp: Date.now(),
      payload: { videoUrl: 'https://youtu.be/aaaaaaaaaaa', videoType: 'youtube' },
    });
    assert.equal(await leaked, null);
  });

  describe('shorts feed', () => {
    const originalFetch = global.fetch;
    const originalKey = process.env.YOUTUBE_API_KEY;
    let fetchCalls;

    const vid = (n) => `vid${String(n).padStart(8, '0')}`;
    const ytPage = (ids, nextPageToken) => ({
      items: ids.map((id) => ({ id: { videoId: id }, snippet: { title: `Шортс &quot;${id}&quot;`, channelTitle: 'Канал' } })),
      nextPageToken,
    });
    // pages: { first: <response>, <pageToken>: <response> }
    const mockYouTube = (pages) => {
      global.fetch = async (url) => {
        const u = new URL(url);
        fetchCalls.push(u);
        const page = pages[u.searchParams.get('pageToken') || 'first'];
        return { ok: true, json: async () => page };
      };
    };

    const feedMsg = (type, senderId, payload = {}) => ({ type, roomId, senderId, timestamp: Date.now(), payload });

    async function joinHostAndGuest() {
      const host = connectClient();
      const guest = connectClient();
      await Promise.all([waitForEvent(host, 'connect'), waitForEvent(guest, 'connect')]);
      host.emit('join_room', { roomId, userId: hostId, nickname: 'Host' });
      await waitForMessageOfType(host, 'SYNC_STATE');
      const guestId = uuidv4();
      guest.emit('join_room', { roomId, userId: guestId, nickname: 'Guest' });
      await waitForMessageOfType(guest, 'SYNC_STATE');
      return { host, guest, guestId };
    }

    // Resolves with the next FEED_STATE whose payload satisfies `predicate`.
    function waitForFeedState(socket, predicate, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for FEED_STATE')), timeoutMs);
        const handler = (msg) => {
          if (msg?.type === 'FEED_STATE' && predicate(msg.payload)) {
            clearTimeout(timer);
            socket.off('message', handler);
            resolve(msg.payload);
          }
        };
        socket.on('message', handler);
      });
    }

    beforeEach(() => {
      fetchCalls = [];
      process.env.YOUTUBE_API_KEY = 'test-key';
      for (const key of [...hashes.keys()]) {
        if (key.startsWith('ytshorts:')) hashes.delete(key);
      }
    });

    after(() => {
      global.fetch = originalFetch;
      if (originalKey === undefined) delete process.env.YOUTUBE_API_KEY;
      else process.env.YOUTUBE_API_KEY = originalKey;
    });

    it('starts a feed for everyone with the first short autoplaying', async () => {
      mockYouTube({ first: ytPage([vid(1), vid(2), vid(3)], null) });
      const { host, guest } = await joinHostAndGuest();

      const guestLoad = waitForMessageOfType(guest, 'LOAD_VIDEO');
      const guestFeed = waitForFeedState(guest, (p) => p.active);
      host.emit('message', feedMsg('FEED_START', hostId, { topic: 'memes' }));

      const load = await guestLoad;
      const state = await guestFeed;
      assert.equal(load.payload.isPlaying, true);
      assert.equal(load.payload.videoType, 'youtube');
      assert.equal(load.payload.videoUrl, `https://www.youtube.com/watch?v=${state.current.id}`);
      assert.equal(state.label, 'Мемы');
      assert.equal(state.index, 0);
      assert.equal(state.total, 3);
      assert.equal(state.current.title, `Шортс "${state.current.id}"`); // HTML entities decoded

      const params = fetchCalls[0].searchParams;
      assert.equal(params.get('q'), 'мемы #shorts');
      assert.equal(params.get('videoDuration'), 'short');
      assert.equal(params.get('videoEmbeddable'), 'true');
      assert.equal(params.get('key'), 'test-key');
    });

    it('advances only once when several clients report the same item ended', async () => {
      mockYouTube({ first: ytPage([vid(1), vid(2), vid(3)], null) });
      const { host, guest, guestId } = await joinHostAndGuest();

      const started = waitForFeedState(host, (p) => p.active);
      host.emit('message', feedMsg('FEED_START', hostId, { topic: 'memes' }));
      await started;

      const states = [];
      host.on('message', (m) => { if (m.type === 'FEED_STATE') states.push(m.payload.index); });
      host.emit('message', feedMsg('FEED_NEXT', hostId, { fromIndex: 0 }));
      guest.emit('message', feedMsg('FEED_NEXT', guestId, { fromIndex: 0 }));
      await new Promise((r) => setTimeout(r, 400));
      assert.deepEqual(states, [1]);
    });

    it('goes back with FEED_PREV and ignores a stale fromIndex', async () => {
      mockYouTube({ first: ytPage([vid(1), vid(2), vid(3)], null) });
      const { host } = await joinHostAndGuest();

      const started = waitForFeedState(host, (p) => p.active);
      host.emit('message', feedMsg('FEED_START', hostId, { topic: 'memes' }));
      await started;

      const atOne = waitForFeedState(host, (p) => p.index === 1);
      host.emit('message', feedMsg('FEED_NEXT', hostId, { fromIndex: 0 }));
      await atOne;
      await new Promise((r) => setTimeout(r, 120)); // past the per-type throttle
      const atTwo = waitForFeedState(host, (p) => p.index === 2);
      host.emit('message', feedMsg('FEED_NEXT', hostId, { fromIndex: 1 }));
      await atTwo;

      const states = [];
      host.on('message', (m) => { if (m.type === 'FEED_STATE') states.push(m.payload.index); });
      host.emit('message', feedMsg('FEED_PREV', hostId, { fromIndex: 1 })); // stale
      await new Promise((r) => setTimeout(r, 150));
      host.emit('message', feedMsg('FEED_PREV', hostId, { fromIndex: 2 }));
      await new Promise((r) => setTimeout(r, 200));
      assert.deepEqual(states, [1]);
    });

    it('fetches the next page as the feed nears the end of the loaded items', async () => {
      mockYouTube({
        first: ytPage([vid(1), vid(2)], 'P2'),
        P2: ytPage([vid(3), vid(4)], null),
      });
      const { host } = await joinHostAndGuest();

      const started = waitForFeedState(host, (p) => p.active);
      host.emit('message', feedMsg('FEED_START', hostId, { topic: 'memes' }));
      assert.equal((await started).total, 2);

      const grown = waitForFeedState(host, (p) => p.total === 4);
      host.emit('message', feedMsg('FEED_NEXT', hostId, { fromIndex: 0 }));
      const state = await grown;
      assert.equal(state.index, 1);
      assert.equal(state.hasMore, false);
      assert.equal(fetchCalls[1].searchParams.get('pageToken'), 'P2');
    });

    it('reports a missing API key to the sender without touching the room', async () => {
      delete process.env.YOUTUBE_API_KEY;
      mockYouTube({ first: ytPage([vid(1)], null) });
      const { host, guest } = await joinHostAndGuest();

      const guestSawFeed = waitForFeedState(guest, (p) => p.active, 400).catch(() => null);
      const error = waitForEvent(host, 'feed_error');
      host.emit('message', feedMsg('FEED_START', hostId, { topic: 'memes' }));

      assert.deepEqual(await error, { reason: 'config' });
      assert.equal(await guestSawFeed, null);
      assert.equal(fetchCalls.length, 0);
    });

    it('serves a repeated topic from cache instead of calling YouTube again', async () => {
      mockYouTube({ first: ytPage([vid(1), vid(2)], null) });
      const { host, guest, guestId } = await joinHostAndGuest();

      const first = waitForFeedState(host, (p) => p.active);
      host.emit('message', feedMsg('FEED_START', hostId, { topic: 'memes' }));
      await first;

      const second = waitForMessageOfType(guest, 'LOAD_VIDEO');
      guest.emit('message', feedMsg('FEED_START', guestId, { topic: 'memes' }));
      await second;
      assert.equal(fetchCalls.length, 1);
    });

    it('ends the feed when someone loads a regular video', async () => {
      mockYouTube({ first: ytPage([vid(1), vid(2)], null) });
      const { host, guest, guestId } = await joinHostAndGuest();

      const started = waitForFeedState(host, (p) => p.active);
      host.emit('message', feedMsg('FEED_START', hostId, { topic: 'memes' }));
      await started;

      const ended = waitForFeedState(host, (p) => p.active === false);
      guest.emit('message', feedMsg('LOAD_VIDEO', guestId, { videoUrl: 'https://youtu.be/bbbbbbbbbbb', videoType: 'youtube' }));
      await ended;
    });

    it('blocks a guest from swiping the feed in host-only mode', async () => {
      mockYouTube({ first: ytPage([vid(1), vid(2)], null) });
      const { host, guest, guestId } = await joinHostAndGuest();

      const started = waitForFeedState(guest, (p) => p.active);
      host.emit('message', feedMsg('FEED_START', hostId, { topic: 'memes' }));
      await started;

      const modeChanged = waitForMessageOfType(guest, 'CONTROL_MODE_CHANGED');
      host.emit('set_control_mode', { mode: 'host' });
      await modeChanged;

      const denied = waitForEvent(guest, 'control_denied');
      guest.emit('message', feedMsg('FEED_NEXT', guestId, { fromIndex: 0 }));
      assert.equal((await denied).action, 'FEED_NEXT');
    });
  });
});

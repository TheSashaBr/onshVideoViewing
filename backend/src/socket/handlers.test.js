const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { v4: uuidv4 } = require('uuid');
const { io: ioClient } = require('socket.io-client');

const { redisClient } = require('../redis/client');
const { createRoom } = require('../redis/repository');
const { initSocket } = require('./index');

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
});

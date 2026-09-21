const { redisClient } = require('./client');

const ROOM_TTL = 24 * 60 * 60; // 24 hours

async function createRoom(roomId, hostId) {
  const now = Date.now();
  const roomKey = `room:${roomId}`;
  
  await redisClient.hSet(roomKey, {
    videoUrl: '',
    videoType: 'youtube',
    currentTime: 0,
    isPlaying: 'false',
    playbackRate: 1.0,
    lastUpdatedAt: now,
    lastUpdatedBy: hostId,
    hostId: hostId,
    createdAt: now,
    controlMode: 'anyone'
  });
  
  await redisClient.expire(roomKey, ROOM_TTL);
  return roomId;
}

async function getRoom(roomId) {
  const roomKey = `room:${roomId}`;
  const room = await redisClient.hGetAll(roomKey);
  if (!room || !room.createdAt) return null;
  
  // refresh TTL
  await redisClient.expire(roomKey, ROOM_TTL);
  await redisClient.expire(`${roomKey}:members`, ROOM_TTL);
  await redisClient.expire(`${roomKey}:chat`, ROOM_TTL);
  await redisClient.expire(`${roomKey}:queue`, ROOM_TTL);
  
  return room;
}

async function updateRoomState(roomId, updateData) {
  const roomKey = `room:${roomId}`;
  await redisClient.hSet(roomKey, updateData);
  await redisClient.expire(roomKey, ROOM_TTL);
}

async function addMember(roomId, userId, memberData) {
  const key = `room:${roomId}:members`;
  await redisClient.hSet(key, userId, JSON.stringify(memberData));
  await redisClient.expire(key, ROOM_TTL);
}

async function removeMember(roomId, userId) {
  const key = `room:${roomId}:members`;
  await redisClient.hDel(key, userId);
}

async function getMembers(roomId) {
  const key = `room:${roomId}:members`;
  const membersData = await redisClient.hGetAll(key);
  const members = [];
  for (const [userId, data] of Object.entries(membersData)) {
    members.push({ userId, ...JSON.parse(data) });
  }
  return members;
}

async function addChatMessage(roomId, message) {
  const key = `room:${roomId}:chat`;
  await redisClient.lPush(key, JSON.stringify(message));
  await redisClient.lTrim(key, 0, 99);
  await redisClient.expire(key, ROOM_TTL);
}

async function getChatMessages(roomId) {
  const key = `room:${roomId}:chat`;
  const messages = await redisClient.lRange(key, 0, 99);
  return messages.map(msg => JSON.parse(msg)).reverse();
}

async function addQueueItem(roomId, item) {
  const key = `room:${roomId}:queue`;
  await redisClient.rPush(key, JSON.stringify(item));
  await redisClient.expire(key, ROOM_TTL);
}

async function getQueue(roomId) {
  const key = `room:${roomId}:queue`;
  const items = await redisClient.lRange(key, 0, -1);
  return items.map(item => JSON.parse(item));
}

async function removeQueueItem(roomId, itemId) {
  const key = `room:${roomId}:queue`;
  const items = await getQueue(roomId);
  const filtered = items.filter(item => item.id !== itemId);
  await redisClient.del(key);
  if (filtered.length) {
    await redisClient.rPush(key, filtered.map(item => JSON.stringify(item)));
    await redisClient.expire(key, ROOM_TTL);
  }
  return filtered;
}

async function popNextQueueItem(roomId) {
  const key = `room:${roomId}:queue`;
  const raw = await redisClient.lPop(key);
  return raw ? JSON.parse(raw) : null;
}

async function addVoiceUser(roomId, userId) {
  const key = `room:${roomId}:voice`;
  await redisClient.sAdd(key, String(userId));
  await redisClient.expire(key, ROOM_TTL);
}

async function removeVoiceUser(roomId, userId) {
  const key = `room:${roomId}:voice`;
  await redisClient.sRem(key, String(userId));
}

async function getVoiceUsers(roomId) {
  const key = `room:${roomId}:voice`;
  const users = await redisClient.sMembers(key);
  return users || [];
}

module.exports = {
  createRoom, getRoom, updateRoomState,
  addMember, removeMember, getMembers,
  addChatMessage, getChatMessages,
  addVoiceUser, removeVoiceUser, getVoiceUsers,
  addQueueItem, getQueue, removeQueueItem, popNextQueueItem
};

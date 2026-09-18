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

module.exports = {
  createRoom, getRoom, updateRoomState,
  addMember, removeMember, getMembers,
  addChatMessage, getChatMessages
};

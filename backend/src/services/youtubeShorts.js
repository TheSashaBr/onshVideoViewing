const { redisClient } = require('../redis/client');

const SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';
// Every search.list call costs 100 of the default 10,000 daily quota units,
// so identical topic pages are served from Redis for a few hours.
const CACHE_TTL = 6 * 60 * 60; // seconds
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const VIDEO_ID_RE = /^[\w-]{11}$/;

// Topic ids the client may send; the actual search parameters stay server-side.
const TOPICS = {
  trends: { label: 'Тренды', q: '#shorts', order: 'viewCount', recentOnly: true },
  memes: { label: 'Мемы', q: 'мемы #shorts' },
  animals: { label: 'Животные', q: 'смешные животные #shorts' },
  games: { label: 'Игры', q: 'игры #shorts' },
  sport: { label: 'Спорт', q: 'спорт #shorts' },
  music: { label: 'Музыка', q: 'музыка #shorts' },
  food: { label: 'Еда', q: 'еда рецепты #shorts' },
  facts: { label: 'Факты', q: 'интересные факты #shorts' },
};

class FeedError extends Error {
  // reason: 'config' (key missing/invalid) | 'quota' | 'upstream' | 'invalid' | 'empty' | 'end'
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function resolveTopic({ topic, query } = {}) {
  if (topic && Object.prototype.hasOwnProperty.call(TOPICS, topic)) {
    return { key: `topic:${topic}`, ...TOPICS[topic] };
  }
  const clean = String(query || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  if (!clean) return null;
  return { key: `q:${clean.toLowerCase()}`, label: clean, q: `${clean} #shorts` };
}

const ENTITIES = { '&amp;': '&', '&quot;': '"', '&#39;': "'", '&lt;': '<', '&gt;': '>' };
function decodeEntities(s) {
  return String(s || '').replace(/&(amp|quot|#39|lt|gt);/g, (m) => ENTITIES[m]);
}

async function fetchShortsPage(topic, pageToken = null) {
  const cacheKey = `ytshorts:${topic.key}:${pageToken || 'first'}`;
  const cached = await redisClient.hGetAll(cacheKey);
  if (cached && cached.data) return JSON.parse(cached.data);

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) throw new FeedError('config');

  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    videoDuration: 'short',
    maxResults: '50',
    q: topic.q,
    relevanceLanguage: 'ru',
    safeSearch: 'moderate',
    key: apiKey,
  });
  if (topic.order) params.set('order', topic.order);
  if (topic.recentOnly) params.set('publishedAfter', new Date(Date.now() - WEEK_MS).toISOString());
  if (pageToken) params.set('pageToken', pageToken);

  let res;
  try {
    res = await fetch(`${SEARCH_URL}?${params}`, { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw new FeedError('upstream');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = body?.error?.errors?.[0]?.reason;
    console.error('[FEED] YouTube API error:', res.status, reason);
    if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') throw new FeedError('quota');
    if (res.status === 400 || res.status === 403) throw new FeedError('config');
    throw new FeedError('upstream');
  }

  const page = {
    items: (body.items || [])
      .filter((it) => VIDEO_ID_RE.test(it?.id?.videoId || ''))
      .map((it) => ({
        id: it.id.videoId,
        title: decodeEntities(it.snippet?.title).slice(0, 200),
        channel: decodeEntities(it.snippet?.channelTitle).slice(0, 100),
      })),
    nextPageToken: body.nextPageToken || null,
  };

  await redisClient.hSet(cacheKey, { data: JSON.stringify(page) });
  await redisClient.expire(cacheKey, CACHE_TTL);
  return page;
}

module.exports = { TOPICS, FeedError, resolveTopic, fetchShortsPage };

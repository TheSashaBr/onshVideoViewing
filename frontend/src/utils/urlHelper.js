/**
 * Helper utilities for detecting and parsing video URLs from YouTube, Rutube, and Twitch.
 */

export function parseVideoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();

  // 1. Check YouTube
  // Handles:
  // - youtube.com/watch?v=ID (with any query params in any order)
  // - youtu.be/ID
  // - youtube.com/embed/ID
  // - youtube.com/shorts/ID
  // - youtube.com/live/ID
  // - youtube.com/v/ID
  // - m.youtube.com/...
  // - youtube-nocookie.com/...
  // - Raw 11-char ID
  try {
    const urlObj = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    const host = urlObj.hostname.replace(/^(www\.|m\.)/, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = urlObj.pathname.slice(1).split('/')[0].split('?')[0];
      if (/^[\w-]{11}$/.test(id)) {
        return { platform: 'youtube', id, url: trimmed };
      }
    }

    if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      const v = urlObj.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) {
        return { platform: 'youtube', id: v, url: trimmed };
      }

      const parts = urlObj.pathname.split('/').filter(Boolean);
      if (['embed', 'shorts', 'live', 'v'].includes(parts[0]) && parts[1]) {
        const id = parts[1].split('?')[0];
        if (/^[\w-]{11}$/.test(id)) {
          return { platform: 'youtube', id, url: trimmed };
        }
      }
    }
  } catch (e) {}

  // Regex fallback for YouTube
  const ytRegex = /(?:youtu\.be\/|(?:www\.|m\.)?youtube(?:-nocookie)?\.com\/(?:embed\/|v\/|watch\?.*v=|shorts\/|live\/))([\w-]{11})/;
  const ytMatch = trimmed.match(ytRegex);
  if (ytMatch && ytMatch[1]) {
    return {
      platform: 'youtube',
      id: ytMatch[1],
      url: trimmed,
    };
  }

  // Raw 11-char YouTube ID fallback
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return {
      platform: 'youtube',
      id: trimmed,
      url: trimmed,
    };
  }

  // 2. Check Rutube
  // e.g., https://rutube.ru/video/4b08dc3cb84a9e3d085fa4b4239828e8/
  // or https://rutube.ru/play/embed/4b08dc3cb84a9e3d085fa4b4239828e8
  const rutubeRegex = /rutube\.ru\/(?:video|play\/embed)\/([a-zA-Z0-9]+)/;
  const rutubeMatch = trimmed.match(rutubeRegex);
  if (rutubeMatch && rutubeMatch[1]) {
    return {
      platform: 'rutube',
      id: rutubeMatch[1],
      url: trimmed,
    };
  }

  // 3. Check Twitch
  // Videos: https://www.twitch.tv/videos/123456789
  const twitchVideoRegex = /twitch\.tv\/videos\/([0-9]+)/;
  const twitchVideoMatch = trimmed.match(twitchVideoRegex);
  if (twitchVideoMatch && twitchVideoMatch[1]) {
    return {
      platform: 'twitch',
      twitchType: 'video',
      id: twitchVideoMatch[1],
      url: trimmed,
    };
  }

  // Channels: https://www.twitch.tv/channel_name
  const twitchChannelRegex = /twitch\.tv\/([a-zA-Z0-9_]{3,25})(?:\/|$|\?)/;
  const twitchChannelMatch = trimmed.match(twitchChannelRegex);
  if (twitchChannelMatch && twitchChannelMatch[1]) {
    const channel = twitchChannelMatch[1].toLowerCase();
    // Exclude reserved routes on twitch.tv
    const reserved = ['directory', 'p', 'downloads', 'jobs', 'turbo', 'settings', 'videos'];
    if (!reserved.includes(channel)) {
      return {
        platform: 'twitch',
        twitchType: 'channel',
        id: channel,
        url: trimmed,
      };
    }
  }

  // 4. Check VK Video
  // https://vk.com/video-12345_67890 or https://vkvideo.ru/video-12345_67890
  const vkRegex = /(?:vk\.com|vkvideo\.ru)\/(?:video|clip)(-?\d+_\d+)/;
  const vkMatch = trimmed.match(vkRegex);
  if (vkMatch && vkMatch[1]) {
    return {
      platform: 'vkvideo',
      id: vkMatch[1],
      url: trimmed,
    };
  }

  // 5. Check Yandex Video / Dzen
  // https://dzen.ru/video/watch/VIDEO_ID
  const dzenRegex = /dzen\.ru\/video\/watch\/([a-zA-Z0-9]+)/;
  const dzenMatch = trimmed.match(dzenRegex);
  if (dzenMatch && dzenMatch[1]) {
    return {
      platform: 'dzen',
      id: dzenMatch[1],
      url: trimmed,
    };
  }

  return null;
}

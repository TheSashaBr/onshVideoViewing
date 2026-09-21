import { describe, it, expect } from 'vitest';
import { parseVideoUrl } from './urlHelper';

describe('parseVideoUrl', () => {
  describe('YouTube', () => {
    it('parses a standard watch URL', () => {
      expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
        platform: 'youtube',
        id: 'dQw4w9WgXcQ',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      });
    });

    it('parses a watch URL with extra query params in any order', () => {
      const result = parseVideoUrl('https://www.youtube.com/watch?t=30&v=dQw4w9WgXcQ&feature=share');
      expect(result).toMatchObject({ platform: 'youtube', id: 'dQw4w9WgXcQ' });
    });

    it('parses a youtu.be short link', () => {
      expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toMatchObject({
        platform: 'youtube',
        id: 'dQw4w9WgXcQ',
      });
    });

    it('parses shorts, embed and live paths', () => {
      expect(parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toMatchObject({ platform: 'youtube', id: 'dQw4w9WgXcQ' });
      expect(parseVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toMatchObject({ platform: 'youtube', id: 'dQw4w9WgXcQ' });
      expect(parseVideoUrl('https://www.youtube.com/live/dQw4w9WgXcQ')).toMatchObject({ platform: 'youtube', id: 'dQw4w9WgXcQ' });
    });

    it('parses m.youtube.com and youtube-nocookie.com hosts', () => {
      expect(parseVideoUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toMatchObject({ platform: 'youtube', id: 'dQw4w9WgXcQ' });
      expect(parseVideoUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toMatchObject({ platform: 'youtube', id: 'dQw4w9WgXcQ' });
    });

    it('accepts a bare 11-character video id', () => {
      expect(parseVideoUrl('dQw4w9WgXcQ')).toMatchObject({ platform: 'youtube', id: 'dQw4w9WgXcQ' });
    });

    it('rejects a malformed video id', () => {
      expect(parseVideoUrl('https://www.youtube.com/watch?v=short')).toBeNull();
    });
  });

  describe('Rutube', () => {
    it('parses a standard video URL', () => {
      expect(parseVideoUrl('https://rutube.ru/video/4b08dc3cb84a9e3d085fa4b4239828e8/')).toMatchObject({
        platform: 'rutube',
        id: '4b08dc3cb84a9e3d085fa4b4239828e8',
      });
    });

    it('parses an embed URL', () => {
      expect(parseVideoUrl('https://rutube.ru/play/embed/4b08dc3cb84a9e3d085fa4b4239828e8')).toMatchObject({
        platform: 'rutube',
        id: '4b08dc3cb84a9e3d085fa4b4239828e8',
      });
    });
  });

  describe('Twitch', () => {
    it('parses a VOD URL', () => {
      expect(parseVideoUrl('https://www.twitch.tv/videos/123456789')).toEqual({
        platform: 'twitch',
        twitchType: 'video',
        id: '123456789',
        url: 'https://www.twitch.tv/videos/123456789',
      });
    });

    it('parses a channel URL', () => {
      expect(parseVideoUrl('https://www.twitch.tv/somechannel')).toMatchObject({
        platform: 'twitch',
        twitchType: 'channel',
        id: 'somechannel',
      });
    });

    it('does not treat reserved Twitch routes as channels', () => {
      expect(parseVideoUrl('https://www.twitch.tv/directory')).toBeNull();
      expect(parseVideoUrl('https://www.twitch.tv/downloads')).toBeNull();
    });
  });

  describe('VK Video', () => {
    it('parses a vk.com video URL', () => {
      expect(parseVideoUrl('https://vk.com/video-12345_67890')).toMatchObject({
        platform: 'vkvideo',
        id: '-12345_67890',
      });
    });

    it('parses a vkvideo.ru clip URL', () => {
      expect(parseVideoUrl('https://vkvideo.ru/clip-12345_67890')).toMatchObject({
        platform: 'vkvideo',
        id: '-12345_67890',
      });
    });
  });

  describe('Dzen', () => {
    it('parses a dzen.ru video watch URL', () => {
      expect(parseVideoUrl('https://dzen.ru/video/watch/abc123')).toMatchObject({
        platform: 'dzen',
        id: 'abc123',
      });
    });
  });

  describe('invalid input', () => {
    it('returns null for empty or non-string input', () => {
      expect(parseVideoUrl('')).toBeNull();
      expect(parseVideoUrl(null)).toBeNull();
      expect(parseVideoUrl(undefined)).toBeNull();
    });

    it('returns null for an unsupported URL', () => {
      expect(parseVideoUrl('https://example.com/some/video/page')).toBeNull();
    });
  });
});

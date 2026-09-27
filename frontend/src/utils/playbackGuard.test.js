import { describe, it, expect } from 'vitest';
import { shouldReportPlaybackChange } from './playbackGuard';

const NOW = 100_000;
const base = { now: NOW, remoteGuardUntil: 0, startupGuardUntil: 0 };

describe('shouldReportPlaybackChange', () => {
  it('reports a user pause/play that changes the room state', () => {
    expect(shouldReportPlaybackChange({ ...base, isPlayingNow: false, roomIsPlaying: true })).toBe(true);
    expect(shouldReportPlaybackChange({ ...base, isPlayingNow: true, roomIsPlaying: false })).toBe(true);
  });

  it('treats an event matching the room state as an echo of a command we applied', () => {
    expect(shouldReportPlaybackChange({ ...base, isPlayingNow: false, roomIsPlaying: false })).toBe(false);
    expect(shouldReportPlaybackChange({ ...base, isPlayingNow: true, roomIsPlaying: true })).toBe(false);
  });

  it('ignores a contradicting event right after a remote command, but not later', () => {
    const justAfter = { ...base, remoteGuardUntil: NOW + 500 };
    expect(shouldReportPlaybackChange({ ...justAfter, isPlayingNow: false, roomIsPlaying: true })).toBe(false);
    const later = { ...base, remoteGuardUntil: NOW - 1 };
    expect(shouldReportPlaybackChange({ ...later, isPlayingNow: false, roomIsPlaying: true })).toBe(true);
  });

  it('during startup ignores a pause (autoplay blocked) but still reports a user pressing play', () => {
    const startup = { ...base, startupGuardUntil: NOW + 3000 };
    expect(shouldReportPlaybackChange({ ...startup, isPlayingNow: false, roomIsPlaying: true })).toBe(false);
    expect(shouldReportPlaybackChange({ ...startup, isPlayingNow: true, roomIsPlaying: false })).toBe(true);
  });

  it('never reports from a hidden page (app switched / screen locked pauses the video)', () => {
    expect(shouldReportPlaybackChange({ ...base, pageHidden: true, isPlayingNow: false, roomIsPlaying: true })).toBe(false);
    expect(shouldReportPlaybackChange({ ...base, pageHidden: true, isPlayingNow: true, roomIsPlaying: false })).toBe(false);
  });

  it('can also ignore play during startup for embeds that autoplay on their own', () => {
    const startup = { ...base, startupGuardUntil: NOW + 3000, startupBlocksPlay: true };
    expect(shouldReportPlaybackChange({ ...startup, isPlayingNow: true, roomIsPlaying: false })).toBe(false);
  });
});

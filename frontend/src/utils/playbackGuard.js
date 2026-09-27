import { useMemo, useRef } from 'react';
import { useRoomStore } from '../store/roomStore';

// After we apply a remote command, a native event that contradicts it is for
// this long still treated as fallout of that command (a state change already
// in flight, or the browser refusing to autoplay) rather than a user action.
export const REMOTE_GUARD_MS = 1500;
// Right after the player loads, a pause while the room is playing is almost
// always the browser blocking autoplay, not the user.
export const STARTUP_GUARD_MS = 5000;

// Decides whether a native play/pause from an embedded player is the local
// user's own action (broadcast it to the room) or just the player following
// the room. An event that matches the room state is an echo of a command we
// applied — so real user actions are never lost to a blanket time window.
// A hidden page can't have been clicked: there the browser/player is pausing
// on its own (app switched, screen locked), which must not pause everyone.
export function shouldReportPlaybackChange({
  isPlayingNow,
  roomIsPlaying,
  now,
  remoteGuardUntil,
  startupGuardUntil,
  startupBlocksPlay = false,
  pageHidden = false,
}) {
  if (pageHidden) return false;
  if (isPlayingNow === roomIsPlaying) return false;
  if (now < remoteGuardUntil) return false;
  if (now < startupGuardUntil && (!isPlayingNow || startupBlocksPlay)) return false;
  return true;
}

// startupBlocksPlay: for embeds that may start playing on their own when
// loaded (autoplay we don't control), also ignore "play" during startup.
export function usePlaybackReportGuard({ startupBlocksPlay = false } = {}) {
  const remoteGuardUntil = useRef(0);
  const startupGuardUntil = useRef(Date.now() + STARTUP_GUARD_MS);

  return useMemo(() => ({
    markStartup() {
      startupGuardUntil.current = Date.now() + STARTUP_GUARD_MS;
    },
    markRemoteCommand() {
      remoteGuardUntil.current = Date.now() + REMOTE_GUARD_MS;
    },
    shouldReport(isPlayingNow) {
      return shouldReportPlaybackChange({
        isPlayingNow,
        roomIsPlaying: !!useRoomStore.getState().roomState.isPlaying,
        now: Date.now(),
        remoteGuardUntil: remoteGuardUntil.current,
        startupGuardUntil: startupGuardUntil.current,
        startupBlocksPlay,
        pageHidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      });
    },
  }), [startupBlocksPlay]);
}
